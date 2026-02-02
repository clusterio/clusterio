import { Tag } from "antd";
import React from "react";

import {
	QuestionCircleOutlined, ClockCircleOutlined, StopOutlined, LoadingOutlined,
	CheckCircleOutlined, SaveOutlined, ExportOutlined, DeleteOutlined,
} from "@ant-design/icons";

export const statusOptions = {
	unknown: <Tag color="#8c8c8c" icon={<QuestionCircleOutlined />}>Unknown</Tag>,
	unassigned: <Tag color="#eb2f96" icon={<ClockCircleOutlined />}>Unassigned</Tag>,
	stopped: <Tag color="#cf1322" icon={<StopOutlined />}>Stopped</Tag>,
	starting: <Tag color="#ad8b00" icon={<LoadingOutlined />}>Starting</Tag>,
	running: <Tag color="#389e0d" icon={<CheckCircleOutlined />}>Running</Tag>,
	stopping: <Tag color="#d48806" icon={<LoadingOutlined />}>Stopping</Tag>,
	creating_save: <Tag color="#096dd9" icon={<SaveOutlined />}>Creating Save</Tag>,
	exporting_data: <Tag color="#08979c" icon={<ExportOutlined />}>Exporting Data</Tag>,
	deleted: <Tag color="#262626" icon={<DeleteOutlined />}>Deleted</Tag>,
};

type InstanceStatusTag = {
	status: keyof typeof statusOptions;
};

export default function InstanceStatusTag(props: InstanceStatusTag) {
	return statusOptions[props.status];
}
