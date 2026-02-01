import React from "react";

import * as lib from "@clusterio/lib";
import { Progress, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

export function MetricCpuRatio(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const ratio = props.system.cpuRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricCpuUsed(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const used = props.system.cpuUsed.toLocaleString(undefined, { maximumFractionDigits: 1 });
	const capacity = props.system.cpuCapacity;
	return `${used} / ${capacity}`;
}

export function MetricMemoryRatio(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const ratio = props.system.memoryRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricMemoryUsed(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const used = lib.formatBytes(props.system.memoryUsed, "binary");
	const capacity = lib.formatBytes(props.system.memoryCapacity, "binary");
	return `${used} / ${capacity}`;
}

export function MetricDiskRatio(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const ratio = props.system.diskRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricDiskUsed(props: { system?: lib.SystemInfo }) {
	if (!props.system) {
		return "N/A";
	}
	const used = lib.formatBytes(props.system.diskUsed);
	const capacity = lib.formatBytes(props.system.diskCapacity);
	return `${used} / ${capacity}`;
}

export function RestartRequired(props: { system?: lib.SystemInfo }) {
	if (!props.system || !props.system.restartRequired) {
		return "";
	}
	return <Tooltip title="Restart Required">
		<ReloadOutlined style={{ color: "yellow" }}/>
	</Tooltip>;
}

/**
 * Returns a human-readable duration between two dates.
 *
 * The output includes up to two most significant time units and omits
 * leading zero units. Supported units are weeks, days, hours, minutes,
 * and seconds.
 *
 * Examples: "1w 2d", "2d 3h", "1h 2m", "45s"
 *
 * @param date1 - The starting date.
 * @param date2 - The ending date.
 * @returns A duration string (e.g. "2d 3h").
 */
function humanAbsTimeDiff(date1: number, date2 = 0) {
	let diffMs = Math.abs(date2 - date1);
	const totalSeconds = Math.floor(diffMs / 1000);

	const weeks = Math.floor(totalSeconds / 604800); // 7 * 24 * 60 * 60
	const days = Math.floor((totalSeconds % 604800) / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (weeks > 0) {
		return days > 0 ? `${weeks}w ${days}d` : `${weeks}w`;
	}

	if (days > 0) {
		return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
	}

	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	}

	if (minutes > 0) {
		return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	}

	return `${seconds}s`;
}

export function MetricRelativeDate(props: { timeMs?: number }) {
	if (!props.timeMs || props.timeMs === 0) {
		return "N/A";
	}
	return `${new Date(props.timeMs).toLocaleString()} (${humanAbsTimeDiff(props.timeMs, Date.now())})`;
}
