import React, { useEffect, useContext, useRef, useState } from "react";
import { Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";

const { Paragraph } = Typography;


function formatParsedOutput(parsed, key) {
	let time = "";
	if (parsed.format === "seconds") {
		time = <span className="factorio-time">{parsed.time.padStart(8)} </span>;
	} else if (parsed.format === "date") {
		time = <span className="factorio-time">{parsed.time} </span>;
	}

	let info = "";
	if (parsed.type === "log") {
		let level = parsed.level;
		if (level === "Script") {
			level = <span className="factorio-script">{level}</span>;
		} else if (level === "Verbose") {
			level = <span className="factorio-verbose">{level}</span>;
		} else if (level === "Info") {
			level = <span className="factorio-info">{level}</span>;
		} else if (parsed.level === "Warning") {
			level = <span className="factorio-warning">{level}</span>;
		} else if (parsed.level === "Error") {
			level = <span className="factorio-error">{level}</span>;
		}

		info = <>{level} <span className="factorio-filename">{parsed.file}: </span></>;

	} else if (parsed.type === "action") {
		info = <>[<span className="factorio-action">{parsed.action}</span>] </>;
	}

	return <span key={key}>{time}{info}{parsed.message}<br/></span>;
}

function formatLog(info, key) {
	if (info.level === "server" && info.parsed) {
		return formatParsedOutput(info.parsed, key);
	}
	let level = <span className={`log-${info.level}`}>{info.level}</span>;
	return <span key={key}>[{level}] {info.message}<br/></span>;
}

export default function LogConsole(props) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let anchor = useRef();
	let [pastLines, setPastLines] = useState([<span key={0}>{"Loading past entries..."}<br/></span>]);
	let [lines, setLines] = useState([]);

	useEffect(() => {
		let logFilter = {
			all: props.all || false,
			controller: props.controller || false,
			hostIds: props.hosts || [],
			instanceIds: props.instances || [],
		};

		// Scroll view to the anchor so it sticks to the bottom
		let parent = anchor.current.parentElement;
		parent.scrollTop = parent.scrollHeight - parent.clientHeight;

		if (account.hasPermission("core.log.query")) {
			setPastLines([<span key={0}>{"Loading past entries..."}<br/></span>]);
			control.send(new lib.LogQueryRequest(
				logFilter.all,
				logFilter.controller,
				logFilter.hostIds,
				logFilter.instanceIds,
				undefined,
				400,
				"desc",
			)).then(result => {
				setPastLines(result.log.map((info, index) => formatLog(info, -index - 1)).reverse());
			}).catch(err => {
				setPastLines([<span key={0}>{`Error loading log: ${err.message}`}<br/></span>]);
			});
		} else {
			setPastLines([]);
		}

		function logHandler(info) {
			setLines(currentLines => currentLines.concat(
				[formatLog(info, currentLines.length)]
			));
		}

		control.onLog(logFilter, logHandler);
		return () => {
			control.offLog(logFilter, logHandler);
		};
	}, [props.all, props.controller, (props.hosts || []).join(), (props.instances || []).join()]);

	return <>
		<Paragraph code className="instance-console">
			{pastLines}
			{lines}
			<div className="scroll-anchor" key="anchor" ref={anchor} />
		</Paragraph>
	</>;
}

