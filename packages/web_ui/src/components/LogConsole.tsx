import React, { useEffect, useContext, useRef, useState, ReactElement } from "react";
import { Select, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import useLocalStorage from "../util/useLocalStorage";
import ControlContext from "./ControlContext";

const { Paragraph } = Typography;

const consoleHeightKey = "instance-console-height";
const defaultConsoleHeight = 300;

type Parsed = {
	format: string;
	type: string;
	level: string;
	time: string;
	file: string;
	action: string;
	message: string;
};

function formatParsedOutput(parsed: Parsed, key: number) {
	let time: ReactElement|string = "";
	if (parsed.format === "seconds") {
		time = <span className="factorio-time">{parsed.time.padStart(8)} </span>;
	} else if (parsed.format === "date") {
		time = <span className="factorio-time">{parsed.time} </span>;
	}

	let info: ReactElement|string = "";
	if (parsed.type === "log") {
		let level: ReactElement|string = parsed.level;
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

type Info = {
	level: keyof typeof lib.levels;
	message: string;
	parsed?: Parsed;
};

function formatLog(info: Info, key: number): ReactElement {
	if (info.level === "server" && info.parsed) {
		return formatParsedOutput(info.parsed, key);
	}
	let level = <span className={`log-${info.level}`}>{info.level}</span>;
	return <span key={key}>[{level}] {info.message}<br/></span>;
}

/**
 * Test if a log entry survives the console's actions only filter
 *
 * The filter narrows the console down to what happened on the server,
 * rather than everything the cluster wrote about it.  Anything reporting
 * that something went wrong is kept regardless of source, as hiding it is
 * what makes a filtered console misleading rather than merely terse.
 */
function passesActionsOnly(info: Info) {
	// Clusterio's own entries are its account of running the instance.
	// Keep the ones reporting a problem, drop the routine bookkeeping.
	if (info.level !== "server") {
		return lib.levels[info.level] <= lib.levels.warn;
	}

	// Factorio writes two interleaved streams to stdout.  The console log
	// is date stamped and carries the things done to the server: chat,
	// joins, leaves, commands, and the server's replies to them.  It is
	// kept whole, because a reply is not always an action -- a rejected
	// command is answered with a plain message, and dropping it makes the
	// console look like the command did nothing at all.
	//
	// The engine log is stamped with seconds since start and is verbose
	// diagnostic output, so only its warnings and errors are kept.
	if (info.parsed?.format === "seconds") {
		return info.parsed.level === "Warning" || info.parsed.level === "Error";
	}
	return true;
}

type LogConsoleProps = {
	all?: boolean;
	controller?: boolean;
	hosts?: number[];
	instances?: number[];
	maxLevel?: keyof typeof lib.levels;
	actionsOnly?: boolean;
};

export function SelectMaxLogLevel(props: {
	value: keyof typeof lib.levels,
	hidden?: (keyof typeof lib.levels)[],
	onChange: (option: keyof typeof lib.levels) => void
}) {
	return <Select
		showSearch
		style={{ width: 100 }}
		defaultValue={props.value}
		onChange={props.onChange}
		options={(Object.entries(lib.levels) as [keyof typeof lib.levels, number][])
			.filter(([level]) => !props.hidden || !props.hidden.includes(level))
			.map(([level, index]) => ({
				value: level, label: level.charAt(0).toUpperCase() + level.slice(1), index: index,
			}))
			.sort((a, b) => a.index - b.index)
		}
	/>;
}

export default function LogConsole(props: LogConsoleProps) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let anchor = useRef<any>();
	let [pastLines, setPastLines] = useState([<span key={0}>{"Loading past entries..."}<br/></span>]);
	let [lines, setLines] = useState<ReactElement[]>([]);
	const [consoleHeight, setConsoleHeight] = useLocalStorage(consoleHeightKey, defaultConsoleHeight);
	const consoleHeightRef = useRef(consoleHeight);
	consoleHeightRef.current = consoleHeight;

	// The console is resized with the browser's native resize handle, which owns
	// the element's inline height. Driving the height from React would rewrite
	// that inline style on every re-render and fight the drag (locking the size),
	// so the height is only read here (on mount) and persisted (on resize), never
	// written back through React. The scroll container is the <code> element
	// wrapping the anchor.
	useEffect(() => {
		const element = anchor.current?.parentElement as HTMLElement | undefined;
		if (!element) {
			return undefined;
		}
		element.style.height = `${consoleHeightRef.current}px`;

		if (typeof ResizeObserver === "undefined") {
			return undefined;
		}
		const observer = new ResizeObserver(() => {
			const next = Math.round(element.offsetHeight);
			if (next && next !== consoleHeightRef.current) {
				consoleHeightRef.current = next;
				setConsoleHeight(next);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		let logFilter = {
			all: props.all || false,
			controller: props.controller || false,
			hostIds: props.hosts || [],
			instanceIds: props.instances || [],
			maxLevel: props.maxLevel || undefined,
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
				logFilter.maxLevel,
				400,
				"desc",
			)).then(result => {
				setPastLines(result.log
					.filter(info => !props.actionsOnly || passesActionsOnly(info as Info))
					.map((info, index) => formatLog(info as Info, -index - 1))
					.reverse()
				);
			}).catch(err => {
				setPastLines([<span key={0}>{`Error loading log: ${err.message}`}<br/></span>]);
			});
		} else {
			setPastLines([]);
		}

		function logHandler(info: Info) {
			if (!props.actionsOnly || passesActionsOnly(info)) {
				setLines(currentLines => currentLines.concat(
					[formatLog(info, currentLines.length)]
				));
			}
		}

		setLines([]);
		control.onLog(logFilter, logHandler);
		return () => {
			control.offLog(logFilter, logHandler);
		};
	}, [
		props.all,
		props.controller,
		(props.hosts || []).join(),
		(props.instances || []).join(),
		props.maxLevel,
		props.actionsOnly,
	]);

	return <>
		<Paragraph code className="instance-console">
			{/* Scrollable spacer (one console-height tall) that keeps short output
			    pinned to the bottom and leaves room to scroll up. Unlike a
			    padding-top it is scroll content, so it does not constrain resize. */}
			<div className="console-spacer" key="spacer" />
			{pastLines}
			{lines}
			<div className="scroll-anchor" key="anchor" ref={anchor} />
		</Paragraph>
	</>;
}
