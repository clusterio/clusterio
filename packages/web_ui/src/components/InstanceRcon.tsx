import React, { useContext, useEffect, useRef, useState } from "react";
import { Input, Typography } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";

const { Title, Paragraph } = Typography;

type RconOutput = { data: string; id: number } | null;

type InstanceRconProps = {
	id: number;
	disabled: boolean;
};
export default function InstanceRcon(props: InstanceRconProps) {
	let control = useContext(ControlContext);
	let [output, setOutput] = useState<RconOutput>(null);
	let [running, setRunning] = useState(false);
	let resultRef = useRef<HTMLDivElement>(null);
	let outputIdRef = useRef(0);

	// Flash the output box whenever the output state changes.
	useEffect(() => {
		let el = resultRef.current;
		if (!el || !output) {
			return;
		}
		let codeEl = el.querySelector("code");
		if (codeEl) {
			codeEl.style.animation = "none";
			void codeEl.offsetWidth; // Force reflow to restart animation
			codeEl.style.animation = "rcon-highlight 1s ease-out";
		}
	}, [output]);

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
			// Wrap in object with unique id so React always sees a new
			// state value, even when the result string is identical.
			outputIdRef.current += 1;
			setOutput({ data: result, id: outputIdRef.current });
		} finally {
			setRunning(false);
		}
	}

	return <>
		{output && <>
			<Title level={5}>Rcon result</Title>
			<div ref={resultRef}>
				<Paragraph code className="rcon-result">{output.data}</Paragraph>
			</div>
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

