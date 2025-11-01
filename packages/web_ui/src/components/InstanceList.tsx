import React from "react";
import { useNavigate } from "react-router-dom";
import { message, Button, Table, Space } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";
import type { SizeType } from "antd/es/config-provider/SizeContext";
import type { ColumnsType } from "antd/es/table";

import { useAccount } from "../model/account";
import { useSystems } from "../model/system";
import { useHosts } from "../model/host";
import { RestartRequired } from "./system_metrics";
import InstanceStatusTag from "./InstanceStatusTag";
import InstanceControlButton, { InstanceControlButtonPermissions } from "./InstanceControlButton";
import * as lib from "@clusterio/lib";
import Link from "./Link";
import { instancePublicAddress } from "../util/instance";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

type InstanceListProps = {
	instances: ReadonlyMap<number, Readonly<lib.InstanceDetails>>;
	size?: SizeType;
	hideAssignedHost?: boolean;
};

export default function InstanceList(props: InstanceListProps) {
	let account = useAccount();
	let navigate = useNavigate();
	let [hosts] = useHosts();
	const [systems] = useSystems();

	function hostName(hostId?: number) {
		if (hostId === undefined) {
			return "";
		}
		return hosts.get(hostId)?.name ?? String(hostId);
	}

	function integerFactorioVersionOrDefault(instance: lib.InstanceDetails) {
		if (instance.factorioVersion === undefined) {
			return -1;
		}
		return lib.integerFactorioVersion(instance.factorioVersion);
	}

	let columns: ColumnsType<lib.InstanceDetails> = [
		{
			title: "Name",
			dataIndex: "name",
			defaultSortOrder: "ascend",
			sorter: (a, b) => strcmp(a["name"], b["name"]),
		},
		{
			title: "Assigned Host",
			key: "assignedHost",
			render: (_, instance) => <Space>
				<Link
					to={`/hosts/${instance.assignedHost}/view`}
					onClick={e => e.stopPropagation()}
				>
					{hostName(instance.assignedHost)}
				</Link>
				<RestartRequired system={instance.assignedHost ? systems.get(instance.assignedHost) : undefined}/>
			</Space>,
			sorter: (a, b) => strcmp(hostName(a.assignedHost), hostName(b.assignedHost)),
			responsive: ["sm"],
		},
		{
			title: "Public address",
			key: "publicAddress",
			render: (_, instance) => {
				let publicAddress = instancePublicAddress(instance, hosts.get(instance.assignedHost!) ?? null);
				return publicAddress ? <>
					{publicAddress}
					<Button
						type="text"
						icon={<CopyOutlined />}
						onClick={(e) => {
							e.stopPropagation();
							navigator.clipboard.writeText(publicAddress ?? "");
							message.success("Copied public address!");
						}}
					/>
				</> : "";
			},
			sorter: (a, b) => strcmp(
				instancePublicAddress(a, hosts.get(a.assignedHost!) ?? null),
				instancePublicAddress(b, hosts.get(b.assignedHost!) ?? null)
			),
			responsive: ["lg"],
		},
		{
			title: "Factorio Version",
			key: "version",
			render: (_, instance) => instance.factorioVersion ?? "unknown",
			sorter: (a, b) => integerFactorioVersionOrDefault(a) - integerFactorioVersionOrDefault(b),
			responsive: ["xl"],
		},
		{
			title: "Status",
			key: "status",
			render: (_, instance) => <InstanceStatusTag status={instance["status"]} />,
			sorter: (a, b) => strcmp(a["status"], b["status"]),
		},
	];

	if (account.hasAnyPermission(...InstanceControlButtonPermissions)) {
		columns.push({
			key: "action",
			render: (_, instance) => <InstanceControlButton size="small" instance={instance} />,
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
