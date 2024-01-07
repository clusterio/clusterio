import React, { useContext, useState } from "react";
import { Button } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { ButtonProps } from "antd/es/button";

type StartStopInstanceButtonProps = {
	instance: lib.InstanceDetails;
	onFinish?: () => void;
	buttonProps?: ButtonProps;
};
export default function StartStopInstanceButton(props: StartStopInstanceButtonProps) {
	let control = useContext(ControlContext);
	let [switching, setSwitching] = useState<boolean>(false);

	function onClick(event: React.MouseEvent<HTMLElement>) {
		event.stopPropagation();
		setSwitching(true);
		let action;
		if (props.instance.status === "stopped") {
			action = control.sendTo(
				{ instanceId: props.instance.id },
				new lib.InstanceStartRequest(undefined),
			).catch(
				notifyErrorHandler("Error starting instance")
			);

		} else if (["starting", "running"].includes(props.instance.status)) {
			action = control.sendTo(
				{ instanceId: props.instance.id },
				new lib.InstanceStopRequest(),
			).catch(
				notifyErrorHandler("Error stopping instance")
			);

		} else {
			setSwitching(false);
			return;
		}

		action.finally(() => {
			setSwitching(false);
			if (props.onFinish) {
				props.onFinish();
			}
		});
	};

	return <Button
		{...(props.buttonProps || {})}
		loading={switching}
		type="primary"
		disabled={!["starting", "running", "stopped"].includes(props.instance.status)}
		onClick={onClick}
	>
		{props.instance.status === "stopped" ? "Start" : "Stop"}
	</Button>;
}
