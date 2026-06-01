import React from "react";
import { Table, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import { formatDuration } from "../util/time_format";
import {
	formatFirstSeen, formatLastSeen, sortFirstSeen, sortLastSeen,
	useUsers, calculateLastSeen, getUserStats, isUserOnline,
} from "../model/user";

import { onFilterUser, Username, useUserFilter } from "./UsersFilters";
import Link from "./Link";

export interface UsersTableProps {
	/** Optional instance id. If provided, stats will be filtered to that instance only */
	instanceId?: number;
	/** Show only players that are currently online, works with instanceId to show online of a particular instance */
	onlyOnline?: boolean;
	/** Ant Design pagination prop. Pass `false` to disable pagination. */
	pagination?: false | object;
	/** Ant Design size prop */
	size?: "small" | "middle" | "large";
}

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export default function UsersTable({ instanceId, onlyOnline = false, pagination, size }: UsersTableProps) {
	const [roles, rolesSynced] = useRoles();
	const [users, usersSynced] = useUsers();
	const navigate = useNavigate();

	const {filterDropdown, filterDropdownProps} = useUserFilter(true);

	const data = [...users.values()];
	const roleFilters = [...roles.values()].map(role => ({ text: role.name, value: role.id }));

	const columns: any[] = [
		{
			title: "Name",
			key: "name",
			render: (_: any, user: lib.UserDetails) => (
				<Username user={user} withStatus />
			),
			defaultSortOrder: "ascend",
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => strcmp(a.name, b.name),
			filterIcon: (filtered: boolean) => (
				<SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
			),
			onFilter: onFilterUser,
			filterDropdownProps,
			filterDropdown,
		},
		{
			title: "Roles",
			key: "roles",
			filters: roleFilters,
			filterMultiple: true,
			onFilter: (value: string | number | boolean, record: lib.UserDetails) => (
				record.roleIds.has(value as number)
			),
			render: (_: any, user: lib.UserDetails) => (
				[...user.roleIds].map((id) => (
					<Link key={id} to={`/roles/${id}/view`} onClick={(e) => e.stopPropagation()}>
						<Tag>{(roles.get(id) || { name: id }).name}</Tag>
					</Link>
				))
			),
		},
		{
			title: "Online Time",
			key: "onlineTime",
			render: (_: any, user: lib.UserDetails) => {
				const userStats = getUserStats(user, instanceId);
				return userStats?.onlineTimeMs ? formatDuration(userStats.onlineTimeMs) : "-";
			},
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => {
				const statsA = getUserStats(a, instanceId);
				const statsB = getUserStats(b, instanceId);
				return (statsA?.onlineTimeMs ?? 0) - (statsB?.onlineTimeMs ?? 0);
			},
		},
		{
			title: "Join Count",
			key: "joinCount",
			render: (_: any, user: lib.UserDetails) => (
				getUserStats(user, instanceId)?.joinCount ?? 0
			),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => {
				const statsA = getUserStats(a, instanceId);
				const statsB = getUserStats(b, instanceId);
				return (statsA?.joinCount ?? 0) - (statsB?.joinCount ?? 0);
			},
		},
		{
			title: "First Seen",
			key: "firstSeen",
			render: (_: any, user: lib.UserDetails) => formatFirstSeen(user, instanceId),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortFirstSeen(a, b, instanceId, instanceId),
		},
		{
			title: "Last Seen",
			key: "lastSeen",
			filterMultiple: false,
			defaultFilteredValue: onlyOnline ? ["online"] : undefined,
			filters: [
				{ text: "Online", value: "online" },
				{ text: "24h", value: "24h" },
				{ text: "7d", value: "7d" },
				{ text: "30d", value: "30d" },
				{ text: "Anytime", value: "any" },
			],
			onFilter: (value: string | number | boolean, record: lib.UserDetails) => {
				const online = isUserOnline(record, instanceId);
				if (value === "online") {
					return online;
				}
				// Online players should appear in all buckets
				if (online) {
					return true;
				}
				const ts = calculateLastSeen(record, instanceId);
				if (!ts) { return false; }
				const diff = Date.now() - ts;
				switch (value) {
					case "24h":
						return diff <= 24 * 60 * 60 * 1000;
					case "7d":
						return diff <= 7 * 24 * 60 * 60 * 1000;
					case "30d":
						return diff <= 30 * 24 * 60 * 60 * 1000;
					case "any":
						return true;
					default:
						return false;
				}
			},
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortLastSeen(a, b, instanceId, instanceId),
			render: (_: any, user: lib.UserDetails) => formatLastSeen(user, instanceId),
			// Responsive breaks defaultFilteredValue, see: https://github.com/ant-design/ant-design/issues/32847
			// responsive: ["lg"],
		},
	];

	const defaultPagination = pagination === undefined
		? {
			defaultPageSize: 50,
			showSizeChanger: true,
			pageSizeOptions: ["10", "20", "50", "100", "200"],
			showTotal: (total: number) => `${total} Users`,
		}
		: pagination;

	return (
		<Table
			columns={columns}
			dataSource={data}
			rowKey={(user) => user.name}
			pagination={defaultPagination}
			size={size}
			scroll={{ x: "max-content" }}
			loading={!usersSynced || !rolesSynced}
			onRow={(user) => ({
				onClick: (event) => {
					if ((event.target as HTMLElement).closest("a")) {
						return;
					}
					navigate(`/users/${user.name}/view`);
				},
			})}
		/>
	);
}
