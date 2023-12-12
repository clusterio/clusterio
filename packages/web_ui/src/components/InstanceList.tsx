import React from "react";
import { useNavigate } from "react-router-dom";
import { message, Button, Space, Table } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";
import type { SizeType } from "antd/es/config-provider/SizeContext";
import type { ColumnsType } from "antd/es/table";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import InstanceStatusTag from "./InstanceStatusTag";
import StartStopInstanceButton from "./StartStopInstanceButton";
import { InstanceDetails } from "@clusterio/lib";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

type InstanceListProps = {
	instances: ReadonlyMap<number, Readonly<InstanceDetails>>;
	size?: SizeType;
	hideAssignedHost?: boolean;
};

export default function InstanceList(props: InstanceListProps) {
	let account = useAccount();
	let navigate = useNavigate();
	let [hosts] = useHosts();

	function hostName(hostId?: number) {
		if (hostId === undefined) {
			return "";
		}
		return hosts.get(hostId)?.name ?? String(hostId);
	}

	function instancePublicAddress(instance: InstanceDetails) {
		if (instance.assignedHost === undefined) {
			return "";
		}
		let host = hosts.get(instance.assignedHost);
		if (!host || !host.publicAddress) {
			return "";
		}
		if (instance.gamePort === undefined) {
			return host.publicAddress;
		}
		return `${host.publicAddress}:${instance.gamePort}`;
	}

	let columns: ColumnsType<InstanceDetails> = [
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
							navigator.clipboard.writeText(publicAddress??"");
							message.success("Copied public address!");
						}}
					/>
				</> : "";
			},
			sorter: (a, b) => strcmp(instancePublicAddress(a), instancePublicAddress(b)),
			responsive: ["lg"],
		},
		{
			title: "Status",
			key: "status",
			render: instance => <InstanceStatusTag status={instance["status"]} />,
			sorter: (a, b) => strcmp(a["status"], b["status"]),
		},
	];

	if (account.hasAnyPermission("core.instance.start", "core.instance.stop")) {
		columns.push({
			key: "action",
			render: instance => <StartStopInstanceButton
				buttonProps={{ size: "small" }}
				instance={instance}
			/>,
			responsive: ["sm"],
			align: "right",
			width: 100,
		});
	}

	if (props.hideAssignedHost) {
		columns.splice(1, 1);
	}

	return <Table
		size={props.size || "large"}
		columns={columns}
		dataSource={[...props.instances.values()]}
		rowKey={instance => instance["id"]}
		pagination={false}
		onRow={(record, rowIndex) => ({
			onClick: event => {
				navigate(`/instances/${record.id}/view`);
			},
		})}
	/>;
}
