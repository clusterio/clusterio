import React from "react";
import { Table, Tag, Space } from "antd";
import { ColumnsType } from "antd/es/table";

import * as lib from "@clusterio/lib";

import { useUsers, formatFirstSeen } from "../model/user";
import { useRoles } from "../model/roles";
import { formatDuration } from "../util/time_format";
import Link from "./Link";

type OnlinePlayersListProps = {
	instanceId: number;
};

export default function OnlinePlayersList({ instanceId }: OnlinePlayersListProps) {
	const [users] = useUsers();
	const [roles] = useRoles();

	// Filter users to only show those online on this specific instance
	const onlineUsers = [...users.values()].filter(user => user.instances && user.instances.has(instanceId));

	const columns: ColumnsType<lib.User> = [
		{
			title: "Player",
			key: "name",
			render: (_, user) => (
				<Space>
					<Link to={`/users/${user.name}/view`}>
						{user.name}
					</Link>
					<span>
						{user.isAdmin && <Tag color="gold">Admin</Tag>}
					</span>
				</Space>
			),
			sorter: (a, b) => a.name.localeCompare(b.name),
			defaultSortOrder: "ascend",
		},
		{
			title: "Roles",
			key: "roles",
			render: (_, user) => (
				[...user.roleIds]
					.map(id => (
						<Link key={id} to={`/roles/${id}/view`} onClick={e => e.stopPropagation()}>
							<Tag>{(roles.get(id) || { name: id }).name}</Tag>
						</Link>
					))
			),
		},
		{
			title: "Play Time",
			key: "playTime",
			render: (_, user) => {
				const instanceStats = user.instanceStats.get(instanceId);
				return instanceStats?.onlineTimeMs
					? formatDuration(instanceStats.onlineTimeMs)
					: "-";
			},
			sorter: (a, b) => {
				const statsA = a.instanceStats.get(instanceId);
				const statsB = b.instanceStats.get(instanceId);
				return (statsA?.onlineTimeMs ?? 0) - (statsB?.onlineTimeMs ?? 0);
			},
		},
		{
			title: "Join Count",
			key: "joinCount",
			render: (_, user) => {
				const instanceStats = user.instanceStats.get(instanceId);
				return instanceStats?.joinCount ?? 0;
			},
			sorter: (a, b) => {
				const statsA = a.instanceStats.get(instanceId);
				const statsB = b.instanceStats.get(instanceId);
				return (statsA?.joinCount ?? 0) - (statsB?.joinCount ?? 0);
			},
		},
		{
			title: "First Seen",
			key: "firstSeen",
			render: (_, user) => formatFirstSeen(user, instanceId),
			sorter: (a, b) => {
				const statsA = a.instanceStats.get(instanceId);
				const statsB = b.instanceStats.get(instanceId);
				const firstSeenA = statsA?.firstJoinAt?.getTime() ?? 0;
				const firstSeenB = statsB?.firstJoinAt?.getTime() ?? 0;
				return firstSeenA - firstSeenB;
			},
		},
	];

	if (onlineUsers.length === 0) {
		return null;
	}

	return (
		<div style={{ marginTop: 16 }}>
			<h4>Online Players ({onlineUsers.length})</h4>
			<Table
				columns={columns}
				dataSource={onlineUsers}
				rowKey={user => user.name}
				pagination={false}
				size="small"
				onRow={(user) => ({
					onClick: (event) => {
						// Don't navigate if clicking on a link
						if ((event.target as HTMLElement).closest("a")) {
							return;
						}
						window.location.href = `/users/${user.name}/view`;
					},
				})}
			/>
		</div>
	);
}
