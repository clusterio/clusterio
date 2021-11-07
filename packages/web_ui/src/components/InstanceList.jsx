import React from "react";
import { useHistory } from "react-router-dom";
import { message, Button, Table } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";

import { useSlaveList } from "../model/slave";
import InstanceStatusTag from "./InstanceStatusTag";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

export default function InstanceList(props) {
	let history = useHistory();
	let [slaveList] = useSlaveList();

	function slaveName(slaveId) {
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
		},
		{
			title: "Status",
			dataIndex: "status",
			render: status => <InstanceStatusTag status={status} />,
			sorter: (a, b) => strcmp(a["status"], b["status"]),
		},
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
