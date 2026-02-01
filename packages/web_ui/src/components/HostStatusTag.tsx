import { Tag } from "antd";
import React from "react";

import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";

const statusOptions = {
	connected: <Tag color="#389e0d" icon={<CheckCircleOutlined/>} >Connected</Tag>,
	disconnected: <Tag color="#cf1322" icon={<CloseCircleOutlined/>} >Disconnected</Tag>,
};

type HostStatusTagProps = {
	connected: boolean;
};

export default function HostStatusTag(props: HostStatusTagProps) {
	return props.connected ? statusOptions.connected : statusOptions.disconnected;
}
