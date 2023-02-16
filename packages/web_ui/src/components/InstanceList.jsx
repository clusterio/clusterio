import React from "react";
import { useHistory } from "react-router-dom";
import { message, Button, Space, Table } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";

import { useAccount } from "../model/account";
import { useSlaveList } from "../model/slave";
import InstanceStatusTag from "./InstanceStatusTag";
import StartStopInstanceButton from "./StartStopInstanceButton";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

export default function InstanceList(props) {
	let account = useAccount();
	let history = useHistory();
	let [slaveList] = useSlaveList();

	function slaveName(slaveId) {
		if (slaveId === null) {
			return "";
		}
		let slave = slaveList.find(s => s.id === slaveId);
		if (slave) {
			return slave.name;
		}
		return String(slaveId);
	}

	function instancePublicAddress(instance) {
		let slave = slaveList.find(s => s.id === instance.assigned_slave);
		if (slave && slave.public_address) {
			if (instance.game_port) {
				return `${slave.public_address}:${instance.game_port}`;
			}
			return slave.public_address;
		}
		return null;
	}

	let columns = [
		{
			title: "Name",
			dataIndex: "name",
			defaultSortOrder: "ascend",
			sorter: (a, b) => strcmp(a["name"], b["name"]),
		},
		{
			title: "Assigned Slave",
			key: "assigned_slave",
			render: instance => slaveName(instance["assigned_slave"]),
			sorter: (a, b) => strcmp(slaveName(a["assigned_slave"]), slaveName(b["assigned_slave"])),
			responsive: ["sm"],
		},
		{
			title: "Public address",
			key: "public_address",
			render: instance => {
				let public_address = instancePublicAddress(instance);
				return public_address ? <>
					{public_address}
					<Button
						type="text"
						icon={<CopyOutlined/>}
						onClick={(e) => {
							e.stopPropagation();
							navigator.clipboard.writeText(public_address);
							message.success("Copied public address!");
						}}
					/>
				</> : "";
			},
			sorter: (a, b) => strcmp(slavePublicAddress(a["assigned_slave"]), slavePublicAddress(b["assigned_slave"])),
			responsive: ["lg"],
		},
		{
			title: "Status",
			key: "status",
			render: instance => <InstanceStatusTag status={instance["status"]} />,
			sorter: (a, b) => strcmp(a["status"], b["status"]),
		},
		...(account.hasAnyPermission("core.instance.start", "core.instance.stop") ? [{
			key: "action",
			render: instance => <StartStopInstanceButton
				buttonProps={{ size: "small" }}
				instance={instance}
			/>,
			responsive: ["sm"],
			align: "right",
			width: 100,
		}] : []),
	];

	if (props.hideAssignedSlave) {
		columns.splice(1, 1);
	}

	return <Table
		size={props.size || "large"}
		columns={columns}
		dataSource={props.instances}
		rowKey={instance => instance["id"]}
		pagination={false}
		onRow={(record, rowIndex) => ({
			onClick: event => {
				history.push(`/instances/${record.id}/view`);
			},
		})}
	/>;
}
