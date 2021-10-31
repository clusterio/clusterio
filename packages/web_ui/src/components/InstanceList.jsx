import React from "react";
import { useHistory } from "react-router-dom";
import { Table } from "antd";

import { useSlaveList } from "../model/slave";

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
			title: "Status",
			dataIndex: "status",
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
