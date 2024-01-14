import React from "react";

import * as lib from "@clusterio/lib";
import { Progress } from "antd";

export function MetricCpuRatio(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const ratio = props.metrics.cpuRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricCpuUsed(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const used = props.metrics.cpuUsed.toLocaleString(undefined, { maximumFractionDigits: 1 });
	const capacity = props.metrics.cpuCapacity;
	return `${used} / ${capacity}`;
}

export function MetricMemoryRatio(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const ratio = props.metrics.memoryRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricMemoryUsed(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const used = lib.formatBytes(props.metrics.memoryUsed, "binary");
	const capacity = lib.formatBytes(props.metrics.memoryCapacity, "binary");
	return `${used} / ${capacity}`;
}

export function MetricDiskRatio(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const ratio = props.metrics.diskRatio;
	return <Progress status="normal" percent={Math.ceil(ratio * 100)}/>;
}

export function MetricDiskUsed(props: { metrics?: lib.SystemMetrics }) {
	if (!props.metrics) {
		return "N/A";
	}
	const used = lib.formatBytes(props.metrics.diskUsed);
	const capacity = lib.formatBytes(props.metrics.diskCapacity);
	return `${used} / ${capacity}`;
}
