import React, { useContext, useState } from "react";
import { Input, Typography } from "antd";

import libLink from "@clusterio/lib/link";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";

const { Title, Paragraph } = Typography;


export default function InstanceRcon(props) {
	let control = useContext(ControlContext);
	let [output, setOutput] = useState(null);
	let [running, setRunning] = useState(false);

	async function sendCommand(command) {
		if (!command) {
			setOutput(null);
			return;
		}

		setRunning(true);
		try {
			let result = await libLink.messages.sendRcon.send(control, {
				instance_id: props.id,
				command: command,
			});
			setOutput(result.result);
		} finally {
			setRunning(false);
		}
	}

	return <>
		{output && <>
			<Title level={5}>Rcon result</Title>
			<Paragraph code className="rcon-result">{output}</Paragraph>
		</>}
		<Input.Search
			disabled={props.disabled}
			placeholder="Send RCON Command"
			enterButton="Send"
			onSearch={(command) => sendCommand(command).catch(notifyErrorHandler("Error sending command"))}
			loading={running}
		/>
	</>;
}

