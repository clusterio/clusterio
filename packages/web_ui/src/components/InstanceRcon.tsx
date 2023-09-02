import React, { useContext, useState } from "react";
import { Input, Typography } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";

const { Title, Paragraph } = Typography;


type InstanceRconProps = {
	id: number;
	disabled: boolean;
};
export default function InstanceRcon(props: InstanceRconProps) {
	let control = useContext(ControlContext);
	let [output, setOutput] = useState<string|null>(null);
	let [running, setRunning] = useState(false);

	async function sendCommand(command: string) {
		if (!command) {
			setOutput(null);
			return;
		}

		setRunning(true);
		try {
			let result = await control.sendTo(
				{ instanceId: props.id },
				new lib.InstanceSendRconRequest(command),
			);
			setOutput(result);
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

