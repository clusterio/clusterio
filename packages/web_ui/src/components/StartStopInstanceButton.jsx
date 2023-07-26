import React, { useContext, useState } from "react";
import { Button } from "antd";

import { libData } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";


export default function StartStopInstanceButton(props) {
	let control = useContext(ControlContext);
	let [switching, setSwitching] = useState(false);

	function onClick(event) {
		event.stopPropagation();
		setSwitching(true);
		let action;
		if (props.instance["status"] === "stopped") {
			action = control.sendTo(
				{ instanceId: props.instance["id"] },
				new libData.InstanceStartRequest(undefined),
			).catch(
				notifyErrorHandler("Error starting instance")
			);

		} else if (["starting", "running"].includes(props.instance["status"])) {
			action = control.sendTo(
				{ instanceId: props.instance["id"] },
				new libData.InstanceStopRequest(),
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
	}

	return <Button
		{...(props.buttonProps || {})}
		loading={switching}
		type="primary"
		disabled={!["starting", "running", "stopped"].includes(props.instance["status"])}
		onClick={onClick}
	>
		{props.instance["status"] === "stopped" ? "Start" : "Stop"}
	</Button>;
}


