import React from "react";

import * as lib from "@clusterio/lib";
import { Progress } from "antd";

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
