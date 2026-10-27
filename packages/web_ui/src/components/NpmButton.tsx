import { useContext, useEffect, useState } from "react";
import { Button, Checkbox, Modal, Tooltip } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";

/** Updates Clusterio on a machine, plugins are installed and updated from the plugins page */
export function NpmButton(props: {
	target: "controller" | { hostId: number },
	canRestart?: boolean,
	disabled?: boolean
}) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [restart, setRestart] = useState(false);
	const [allowed, setAllowed] = useState(true);

	const isController = props.target === "controller";
	const hostId = props.target === "controller" ? undefined : props.target.hostId;
	useEffect(() => {
		// Without config permission assume it's allowed so the request can still be sent
		if (!account.hasPermission(isController ? "core.controller.get_config" : "core.host.get_config")) {
			setAllowed(true);
			return;
		}
		if (props.target === "controller") {
			control.send(new lib.ControllerConfigGetRequest()).then(serializedConfig => {
				const config = lib.ControllerConfig.fromJSON(serializedConfig, "control");
				setAllowed(config.get("controller.allow_remote_updates"));
			}).catch(notifyErrorHandler("Failed to fetch controller config for remote updates"));
		} else {
			control.sendTo(props.target, new lib.HostConfigGetRequest()).then(serializedConfig => {
				const config = lib.HostConfig.fromJSON(serializedConfig, "control");
				setAllowed(config.get("host.allow_remote_updates"));
			}).catch(notifyErrorHandler("Failed to fetch host config for remote updates"));
		}
	}, [hostId]);

	const canRestart = account.hasPermission(isController ? "core.controller.restart" : "core.host.restart");
	async function onOk() {
		if (props.target === "controller") {
			await control.send(new lib.ControllerUpdateRequest());
		} else {
			await control.sendTo(props.target, new lib.HostUpdateRequest());
		}
		if (restart) {
			if (props.target === "controller") {
				await control.send(new lib.ControllerRestartRequest());
			} else {
				await control.sendTo(props.target, new lib.HostRestartRequest());
			}
		}
		setOpen(false);
	}

	return <>
		<Tooltip title={allowed ? undefined : "Remote updates are disabled on this machine"}>
			<Button disabled={props.disabled || !allowed} onClick={() => { setOpen(true); }}>
				Update Clusterio
			</Button>
		</Tooltip>
		<Modal
			title="Update Clusterio"
			okText="Update"
			open={open}
			onOk={() => { onOk().catch(notifyErrorHandler("Error updating Clusterio")); }}
			onCancel={() => { setOpen(false); }}
			destroyOnHidden
		>
			<p>Updates Clusterio within the version range in the machine's package.json.</p>
			{canRestart && <Checkbox
				checked={restart}
				disabled={props.canRestart === false}
				onChange={event => { setRestart(event.target.checked); }}
			>Restart on completion</Checkbox>}
		</Modal>
	</>;
}

export function hasNpmButtonPermission(controller: boolean) {
	const account = useAccount();
	return account.hasPermission(controller ? "core.controller.update" : "core.host.update");
}
