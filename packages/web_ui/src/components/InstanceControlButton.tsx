import React, { useContext, useState } from "react";
import { Button, MenuProps } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { useAccount } from "../model/account";
import { notifyErrorHandler } from "../util/notify";
import Dropdown, { DropdownButtonProps } from "antd/es/dropdown";

type InstanceControlButtonProps = DropdownButtonProps & {
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

	const onStopStartClick: DropdownButtonProps["onClick"] = (event) => {
		event.stopPropagation();
		setSwitching(true);

		if (showStart) {
			control.sendTo(
				{ instanceId },
				new lib.InstanceStartRequest(undefined),
			).catch(
				notifyErrorHandler("Error starting instance")
			).finally(actionFinish);

		} else {
			control.sendTo(
				{ instanceId },
				new lib.InstanceStopRequest(),
			).catch(
				notifyErrorHandler("Error stopping instance")
			).finally(actionFinish);

		}
	};

	const onMenuClick: MenuProps["onClick"] = (event) => {
		event.domEvent.stopPropagation();
		setSwitching(true);

		switch (event.key) {
			case "restart":
				control.sendTo(
					{ instanceId },
					new lib.InstanceRestartRequest(undefined),
				).catch(
					notifyErrorHandler("Error restarting instance")
				).finally(actionFinish);
				break;

			case "kill":
				control.sendTo(
					{ instanceId },
					new lib.InstanceKillRequest(),
				).catch(
					notifyErrorHandler("Error killing instance")
				).finally(actionFinish);
				break;

			default:
				notifyErrorHandler("Unknown control action");
		}
	};

	const extraControls: MenuProps["items"] = [];
	if (account.hasPermission("core.instance.restart")) {
		extraControls.push({
			key: "restart",
			label: "Restart",
			disabled: instanceStatus !== "running",
		});
	}
	if (account.hasPermission("core.instance.kill")) {
		extraControls.push({
			key: "kill",
			label: "Kill",
			disabled: instanceStatus === "stopped",
		});
	}

	const buttonProps: DropdownButtonProps = {
		...props,
		type: "primary",
		loading: switching,
		onClick: onStopStartClick,
		disabled: !(showStart || showStop),
		danger: showStop !== switching, // Used as an XOR, also below
	};

	return extraControls.length > 0
		? <Dropdown.Button
			{...buttonProps}
			menu={{ items: extraControls, onClick: onMenuClick }}
			buttonsRender={([left, right]) => [ // This is needed to prevent propagation to the table row
				left, React.cloneElement(right as any, { onClick: (e: any) => e.stopPropagation() }),
			]}
		>
			{showStart !== switching ? "Start" : "Stop"}
		</Dropdown.Button>
		: <Button {...buttonProps}>
			{showStart !== switching ? "Start" : "Stop"}
		</Button>;

}
