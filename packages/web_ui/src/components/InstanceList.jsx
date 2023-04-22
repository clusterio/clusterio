import React from "react";
import { useHistory } from "react-router-dom";
import { message, Button, Space, Table } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";

import { useAccount } from "../model/account";
import { useHostList } from "../model/host";
import InstanceStatusTag from "./InstanceStatusTag";
import StartStopInstanceButton from "./StartStopInstanceButton";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

export default function InstanceList(props) {
	let account = useAccount();
	let history = useHistory();
	let [hostList] = useHostList();

	function hostName(hostId) {
		if (hostId === null) {
			return "";
		}
		let host = hostList.find(s => s.id === hostId);
		if (host) {
			return host.name;
		}
		return String(hostId);
	}

	function instancePublicAddress(instance) {
		let host = hostList.find(s => s.id === instance.assignedHost);
		if (host && host.publicAddress) {
			if (instance.gamePort) {
				return `${host.publicAddress}:${instance.gamePort}`;
			}
			return host.publicAddress;
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
			title: "Assigned Host",
			key: "assignedHost",
			render: instance => hostName(instance.assignedHost),
			sorter: (a, b) => strcmp(hostName(a.assignedHost), hostName(b.assignedHost)),
			responsive: ["sm"],
		},
		{
			title: "Public address",
			key: "publicAddress",
			render: instance => {
				let publicAddress = instancePublicAddress(instance);
				return publicAddress ? <>
					{publicAddress}
					<Button
						type="text"
						icon={<CopyOutlined/>}
						onClick={(e) => {
							e.stopPropagation();
							navigator.clipboard.writeText(publicAddress);
							message.success("Copied public address!");
						}}
					/>
				</> : "";
			},
			sorter: (a, b) => strcmp(hostPublicAddress(a.assignedHost), hostPublicAddress(b.assignedHost)),
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

	if (props.hideAssignedHost) {
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
