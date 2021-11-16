import { Tag } from "antd";
import React from "react";

const statusColors = {
	unknown: "#8c8c8c",
	unassigned: "#eb2f96",
	stopped: "#cf1322",
	starting: "#ad8b00",
	running: "#52c41a",
	stopping: "#d48806",
	creating_save: "#096dd9",
	exporting_data: "#08979c",
	deleted: "#262626",
};


export default function InstanceStatusTag(props) {
	return <Tag color={statusColors[props.status]}>
		{props.status.replace("_", " ")}
	</Tag>;
}
