import React from "react";
import { useNavigate } from "react-router-dom";
import { message, Button, Table, Space } from "antd";
import CopyOutlined from "@ant-design/icons/CopyOutlined";
import type { SizeType } from "antd/es/config-provider/SizeContext";
import type { ColumnType } from "antd/es/table/interface";

import { useAccount } from "../model/account";
import { useSystems } from "../model/system";
import { useHosts } from "../model/host";
import { RestartRequired } from "./system_metrics";
import InstanceStatusTag from "./InstanceStatusTag";
import InstanceControlButton, { InstanceControlButtonPermissions } from "./InstanceControlButton";
import * as lib from "@clusterio/lib";
import Link from "./Link";
import { instancePublicAddress } from "../util/instance";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "../util/useColumnSearch";

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
	const tableState = useTableQueryState<lib.InstanceDetails>({
		namespace: "instance", defaultSortKey: "name", pagination: false,
	});
	const nameSearch = useColumnSearch<lib.InstanceDetails>(instance => instance.name, "Search instances");

	function hostName(hostId?: number) {
		if (hostId === undefined) {
			return "";
		}
		return hosts.get(hostId)?.name ?? String(hostId);
	}

	function integerFactorioVersionOrDefault(instance: lib.InstanceDetails) {
		if (instance.factorioVersion === undefined || instance.factorioVersion === "latest") {
			return -1;
		}
		return lib.integerPartialVersion(instance.factorioVersion);
	}

	let columns: ColumnType<lib.InstanceDetails>[] = [
		{
			title: "Name",
			dataIndex: "name",
			sorter: (a, b) => strcmp(a["name"], b["name"]),
			sortOrder: tableState.sortOrder("name"),
			filteredValue: tableState.filteredValue("name"),
			...nameSearch,
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
			sortOrder: tableState.sortOrder("assignedHost"),
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
			sortOrder: tableState.sortOrder("publicAddress"),
			responsive: ["lg"],
		},
		{
			title: "Factorio Version",
			key: "version",
			render: (_, instance) => instance.factorioVersion ?? "unknown",
			sorter: (a, b) => integerFactorioVersionOrDefault(a) - integerFactorioVersionOrDefault(b),
			sortOrder: tableState.sortOrder("version"),
			responsive: ["xl"],
		},
		{
			title: "Status",
			key: "status",
			render: (_, instance) => <InstanceStatusTag status={instance["status"]} />,
			sorter: (a, b) => strcmp(a["status"], b["status"]),
			sortOrder: tableState.sortOrder("status"),
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
		pagination={tableState.pagination}
		onChange={tableState.onChange}
		onRow={(record, rowIndex) => ({
			onClick: event => {
				navigate(`/instances/${record.id}/view`);
			},
		})}
	/>;
}
