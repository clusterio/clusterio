import React, { useContext, useState } from "react";
import { Table, Tooltip } from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import ControlContext from "./ControlContext";
import { useSaves } from "../model/saves";


function formatBytes(bytes) {
	if (bytes === 0) {
		return "0 Bytes";
	}

	let units = [" Bytes", " kB", " MB", " GB", " TB"];
	let factor = 1000;
	let power = Math.min(Math.floor(Math.log(bytes) / Math.log(factor)), units.length);
	return (power > 0 ? (bytes / factor ** power).toFixed(2) : bytes) + units[power];
}

export default function SavesList(props) {
	let control = useContext(ControlContext);
	let saves = useSaves(props.instance.id);

	return <Table
		size="small"
		columns={[
			{
				title: "Name",
				render: save => <>
					{save.name}
					{save.loaded && <Tooltip title="Currently loaded save"><CaretLeftOutlined/></Tooltip>}
					{save.default && <Tooltip title="Save loaded by default"><LeftOutlined/></Tooltip>}
				</>,
				sorter: (a, b) => a.name.localeCompare(b.name),
			},
			{
				title: "Size",
				key: "size",
				responsive: ["sm"],
				render: save => formatBytes(save.size),
				align: "right",
				sorter: (a, b) => a.size - b.size,
			},
			{
				title: "Last Modified",
				key: "mtime_ms",
				render: save => new Date(save.mtime_ms).toLocaleString(),
				sorter: (a, b) => a.mtime_ms - b.mtime_ms,
				defaultSortOrder: "descend",
			},
		]}
		dataSource={saves}
		rowKey={save => save.name}
		pagination={false}
	/>;
}
