import React from "react";
import { Table, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

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

export interface UsersTableProps {
	/** Optional instance id. If provided, stats will be filtered to that instance only */
	instanceId?: number;
	/** Show only players that are currently online, works with instanceId to show online of a particular instance */
	onlyOnline?: boolean;
	/** Ant Design pagination prop. Pass `false` to disable pagination. */
	pagination?: false | object;
	/** Ant Design size prop */
	size?: "small" | "middle" | "large";
	/** Persist sort/filter/pagination state in the URL (for the standalone Users page). */
	persistState?: boolean;
}

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export default function UsersTable(
	{ instanceId, onlyOnline = false, pagination, size, persistState }: UsersTableProps
) {
	const [roles, rolesSynced] = useRoles();
	const [users, usersSynced] = useUsers();
	const navigate = useNavigate();
	const callerPagination = pagination && typeof pagination === "object" ? pagination : undefined;
	const defaultPageSize = (callerPagination as { defaultPageSize?: number })?.defaultPageSize ?? 50;
	const tableState = useTableQueryState<lib.UserDetails>({
		namespace: "user",
		defaultSortKey: "name",
		pagination: pagination === false ? false : { defaultPageSize },
		filterCodecs: { name: userFilterCodec },
	});

	const {filterDropdown, filterDropdownProps} = useUserFilter(true);

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
			filterMultiple: false,
			filters: durationFilters,
			onFilter: (value: any, record: lib.UserDetails) => onFilterDuration(value, record, calculateFirstSeen),
			render: (_: any, user: lib.UserDetails) => formatFirstSeen(user, instanceId),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortFirstSeen(a, b, instanceId, instanceId),
		},
		{
			title: "Last Seen",
			key: "lastSeen",
			filterMultiple: false,
			filters: durationFilters,
			defaultFilteredValue: onlyOnline ? ["online"] : undefined,
			onFilter: (value: any, record: lib.UserDetails) => onFilterDuration(value, record, calculateLastSeen),
			sorter: (a: lib.UserDetails, b: lib.UserDetails) => sortLastSeen(a, b, instanceId, instanceId),
			render: (_: any, user: lib.UserDetails) => formatLastSeen(user, instanceId),
			// Responsive breaks defaultFilteredValue, see: https://github.com/ant-design/ant-design/issues/32847
			// responsive: ["lg"],
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
	} else if (persistState) {
		// Controlled current/pageSize from the URL win over the caller's display props.
		tablePagination = { ...displayPagination, ...callerPagination, ...(tableState.pagination || {}) };
	} else {
		tablePagination = { ...displayPagination, ...(callerPagination ?? { defaultPageSize: 50 }) };
	}

	let tableColumns = persistState ? columns.map(tableState.applyColumn) : columns;
	// Seed the online-only default when nothing for the Last Seen column is in the URL yet.
	if (persistState && onlyOnline && !("lastSeen" in tableState.filters)) {
		tableColumns = tableColumns.map(column => (
			column.key === "lastSeen" ? { ...column, filteredValue: ["online"] } : column
		));
	}

	return (
		<Table
			columns={tableColumns}
			dataSource={data}
			rowKey={(user) => user.name}
			pagination={tablePagination}
			onChange={persistState ? tableState.onChange : undefined}
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
