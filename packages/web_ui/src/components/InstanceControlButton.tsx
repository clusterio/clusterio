import React, { useContext, useState } from "react";
import { Popconfirm } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { useAccount } from "../model/account";
import { notifyErrorHandler } from "../util/notify";
import VariableDropdownButton, { VariableDropdownButtonProps } from "./VariableDropdownButton";

type InstanceControlButtonProps = Omit<VariableDropdownButtonProps, "actions"> & {
	instance: lib.InstanceDetails;
	onFinish?: () => void;
};

export const InstanceControlButtonPermissions = [
	"core.instance.start", "core.instance.restart", "core.instance.stop", "core.instance.kill",
] as const;

export default function InstanceControlButton(props: InstanceControlButtonProps) {
	const account = useAccount();
	const control = useContext(ControlContext);
	const [switching, setSwitching] = useState<boolean>(false);

	const instanceId = props.instance.id;
	const instanceStatus = props.instance.status;
	const showStart = ["stopped", "stopping"].includes(instanceStatus);
	const showStop = ["running", "starting"].includes(instanceStatus);

	function actionFinish() {
		setSwitching(false);
		if (props.onFinish) {
			props.onFinish();
		}
	}

	const actions: VariableDropdownButtonProps["actions"] = [];

	if (account.hasPermission("core.instance.start") && showStart !== switching) {
		actions.push({
			key: "start",
			label: "Start",
			onClick: () => {
				setSwitching(true);
				control.sendTo(
					{ instanceId },
					new lib.InstanceStartRequest(undefined),
				).catch(
					notifyErrorHandler("Error starting instance")
				).finally(actionFinish);
			},
		});

	} else if (account.hasPermission("core.instance.stop")) { // else if because it is stop or start
		actions.push({
			key: "stop",
			label: "Stop",
			danger: true,
			onClick: () => {
				setSwitching(true);
				control.sendTo(
					{ instanceId },
					new lib.InstanceStopRequest(),
				).catch(
					notifyErrorHandler("Error stopping instance")
				).finally(actionFinish);
			},
		});
	}

	if (account.hasPermission("core.instance.restart")) {
		actions.push({
			key: "restart",
			label: "Restart",
			disabled: instanceStatus !== "running",
			onClick: () => {
				setSwitching(true);
				control.sendTo(
					{ instanceId },
					new lib.InstanceRestartRequest(undefined),
				).catch(
					notifyErrorHandler("Error restarting instance")
				).finally(actionFinish);
			},
		});
	}

	if (account.hasPermission("core.instance.kill")) {
		actions.push({
			key: "kill",
			danger: true,
			disabled: instanceStatus === "stopped",
			label: (<Popconfirm
				title={<>
					Killing this instance may leave you save and player data corrupted.
					Are you sure you want to kill the instance?
				</>}
				placement="bottomRight"
				okText="Kill"
				okButtonProps={{ danger: true }}
				onConfirm={() => {
					control.sendTo(
						{ instanceId },
						new lib.InstanceKillRequest(),
					).catch(
						notifyErrorHandler("Error killing instance")
					).finally(actionFinish);
				}}
			>
				Kill
			</Popconfirm>),
		});
	}

	return <VariableDropdownButton
		{...props}
		type="primary"
		actions={actions}
		loading={switching}
		disabled={!(showStart || showStop)}
	/>;
}
