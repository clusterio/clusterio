import React from "react";
import { Table, Tag, type TablePaginationConfig } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import { formatDuration } from "../util/time_format";
import {
	calculateFirstSeen, formatFirstSeen, sortFirstSeen,
	calculateLastSeen, formatLastSeen, sortLastSeen,
	useUsers, getUserStats, isUserOnline,
} from "../model/user";

import { onFilterUser, Username, useUserFilter, userFilterCodec } from "./UsersFilters";
import Link from "./Link";
import useTableQueryState from "../util/useTableQueryState";
import useRowNavigation from "../util/useRowNavigation";

export interface UsersTableProps {
	/** Optional instance id. If provided, stats will be filtered to that instance only */
	instanceId?: number;
	/** Show only players that are currently online, works with instanceId to show online of a particular instance */
	onlyOnline?: boolean;
	/** Ant Design pagination prop. Pass `false` to disable pagination. */
	pagination?: false | TablePaginationConfig;
	/** Ant Design size prop */
	size?: "small" | "middle" | "large";
}

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export default function UsersTable(
	{ instanceId, onlyOnline = false, pagination, size }: UsersTableProps
) {
	const [roles, rolesSynced] = useRoles();
	const [users, usersSynced] = useUsers();
	const tableState = useTableQueryState<lib.UserDetails>({
		namespace: "user",
		defaultSortKey: "name",
		// Default to 50 per page when the caller does not specify a pagination config.
		pagination: pagination === false ? false : (pagination ?? { defaultPageSize: 50 }),
		filterCodecs: { name: userFilterCodec },
	});
	const rowNav = useRowNavigation();

	const {filterDropdown, filterDropdownProps} = useUserFilter(tableState, "name", true);

	const data = [...users.values()];
	const roleFilters = [...roles.values()].map(role => ({ text: role.name, value: role.id }));

	const durationFilters = [
		{ text: "Online", value: "online" },
		{ text: "24h", value: "24h" },
		{ text: "7d", value: "7d" },
		{ text: "30d", value: "30d" },
		{ text: "Anytime", value: "any" },
	];

	function onFilterDuration(
		value: string,
		record: lib.UserDetails,
		calculateDuration: (user: lib.UserDetails, instanceId?: number) => number | undefined,
	) {
		const online = isUserOnline(record, instanceId);
		if (value === "online") {
			return online;
		}

		// Online players should appear in all buckets
		if (online) {
			return true;
		}

		const ts = calculateDuration(record, instanceId);
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
	}

	const columns: any[] = [
		{
			title: "Name",
			key: "name",
			className: "table-link-cell",
			render: (_: any, user: lib.UserDetails) => (
				<Link to={`/users/${user.name}/view`} style={{ color: "inherit" }}>
					<Username user={user} withStatus />
				</Link>
			),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => strcmp(a.name, b.name),
			sortOrder: tableState.sortOrder("name"),
			filteredValue: tableState.filteredValue("name"),
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
			filteredValue: tableState.filteredValue("roles"),
			onFilter: (value: boolean | React.Key, record: lib.UserDetails) => (
				record.roleIds.has(Number(value))
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
			sortOrder: tableState.sortOrder("onlineTime"),
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
			sortOrder: tableState.sortOrder("joinCount"),
		},
		{
			title: "First Seen",
			key: "firstSeen",
			filterMultiple: false,
			filters: durationFilters,
			filteredValue: tableState.filteredValue("firstSeen"),
			onFilter: (value: any, record: lib.UserDetails) => onFilterDuration(value, record, calculateFirstSeen),
			render: (_: any, user: lib.UserDetails) => formatFirstSeen(user, instanceId),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortFirstSeen(a, b, instanceId, instanceId),
			sortOrder: tableState.sortOrder("firstSeen"),
		},
		{
			title: "Last Seen",
			key: "lastSeen",
			filterMultiple: false,
			filters: durationFilters,
			// With the onlyOnline prop set, seed this column's filter to "online" until the
			// URL provides one, so the table starts out showing only online players.
			filteredValue: tableState.filteredValue("lastSeen") ?? (onlyOnline ? ["online"] : null),
			onFilter: (value: any, record: lib.UserDetails) => onFilterDuration(value, record, calculateLastSeen),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortLastSeen(a, b, instanceId, instanceId),
			sortOrder: tableState.sortOrder("lastSeen"),
			render: (_: any, user: lib.UserDetails) => formatLastSeen(user, instanceId),
		},
	];

	const displayPagination = {
		showSizeChanger: true,
		pageSizeOptions: ["10", "20", "50", "100", "200"],
		showTotal: (total: number) => `${total} Users`,
	};
	let tablePagination: false | object;
	if (pagination === false) {
		tablePagination = false;
	} else {
		// Controlled current/pageSize from the URL win over the caller's display props.
		tablePagination = { ...displayPagination, ...pagination, ...(tableState.pagination || {}) };
	}

	return (
		<Table
			columns={columns}
			dataSource={data}
			rowKey={(user) => user.name}
			pagination={tablePagination}
			onChange={tableState.onChange}
			size={size}
			scroll={{ x: "max-content" }}
			loading={!usersSynced || !rolesSynced}
			onRow={(user) => rowNav(`/users/${user.name}/view`)}
		/>
	);
}
