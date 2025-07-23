import React, { useRef } from "react";
import { Table, Tag, Space, Input, InputRef } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import { useUsers } from "../model/user";
import { formatDuration } from "../util/time_format";
import {
    formatFirstSeen, formatLastSeen, sortFirstSeen, sortLastSeen,
} from "../model/user";
import Link from "./Link";

export interface UsersTableProps {
    /**
     * Optional instance id.
     *  – If provided, instance-specific columns (Play Time, Join Count, First Seen) are shown.
     *  – If omitted, global player statistics columns (Online Time, First/Last Seen) are shown.
     */
    instanceId?: number;
    /** Show only players that are currently online. When instanceId is provided players must be online on that instance. */
    onlyOnline?: boolean;
    /** Ant Design pagination prop. Pass `false` to disable pagination. */
    pagination?: false | object;
    /** Ant Design size prop */
    size?: "small" | "middle" | "large";
}

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export default function UsersTable({ instanceId, onlyOnline = false, pagination, size }: UsersTableProps) {
    const [roles] = useRoles();
    const navigate = useNavigate();
    const searchInput = useRef<InputRef>(null);

    const [users] = useUsers();

    let data = [...users.values()];

    if (onlyOnline) {
        if (instanceId !== undefined) {
            data = data.filter(u => u.instances && u.instances.has(instanceId));
        } else {
            data = data.filter(u => u.instances && u.instances.size > 0);
        }
    }

    const columns: any[] = [
        {
            title: "Name",
            key: "name",
            render: (_: any, user: lib.User) => (
                <Space>
                    {user.name}
                    <span>
                        {user.isAdmin && <Tag color="gold">Admin</Tag>}
                        {user.isWhitelisted && <Tag>Whitelisted</Tag>}
                        {user.isBanned && <Tag color="red">Banned</Tag>}
                    </span>
                </Space>
            ),
            defaultSortOrder: "ascend",
            sorter: (a: lib.User, b: lib.User) => strcmp(a.name, b.name),
            filterIcon: (filtered: boolean) => (
                <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
            ),
            onFilter: (value: string | number | boolean, record: lib.User) =>
                record.name.toLowerCase().includes((value as string).toLowerCase()),
            filterDropdownProps: {
                onOpenChange: (open: boolean) => open && setTimeout(() => searchInput.current?.select(), 100),
            },
            filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }: any) => (
                <div style={{ padding: 4 }} onKeyDown={(e) => e.stopPropagation()}>
                    <Input.Search
                        allowClear
                        ref={searchInput}
                        placeholder={"Search username"}
                        value={selectedKeys[0]}
                        onChange={(e) => setSelectedKeys([e.target.value])}
                        onClear={() => clearFilters && clearFilters({ confirm: true, closeDropdown: true })}
                        onSearch={() => confirm({ closeDropdown: true })}
                    />
                </div>
            ),
        },
        {
            title: "Roles",
            key: "roles",
            render: (_: any, user: lib.User) => (
                [...user.roleIds].map((id) => (
                    <Link key={id} to={`/roles/${id}/view`} onClick={(e) => e.stopPropagation()}>
                        <Tag>{(roles.get(id) || { name: id }).name}</Tag>
                    </Link>
                ))
            ),
        },
    ];

    if (instanceId !== undefined) {
        columns.push(
            {
                title: "Play Time",
                key: "playTime",
                render: (_: any, user: lib.User) => {
                    const instanceStats = user.instanceStats.get(instanceId);
                    return instanceStats?.onlineTimeMs ? formatDuration(instanceStats.onlineTimeMs) : "-";
                },
                sorter: (a: lib.User, b: lib.User) => {
                    const statsA = a.instanceStats.get(instanceId);
                    const statsB = b.instanceStats.get(instanceId);
                    return (statsA?.onlineTimeMs ?? 0) - (statsB?.onlineTimeMs ?? 0);
                },
            },
            {
                title: "Join Count",
                key: "joinCount",
                render: (_: any, user: lib.User) => {
                    const instanceStats = user.instanceStats.get(instanceId);
                    return instanceStats?.joinCount ?? 0;
                },
                sorter: (a: lib.User, b: lib.User) => {
                    const statsA = a.instanceStats.get(instanceId);
                    const statsB = b.instanceStats.get(instanceId);
                    return (statsA?.joinCount ?? 0) - (statsB?.joinCount ?? 0);
                },
            },
            {
                title: "First Seen",
                key: "firstSeen",
                render: (_: any, user: lib.User) => formatFirstSeen(user, instanceId),
                sorter: (a: lib.User, b: lib.User) => {
                    const statsA = a.instanceStats.get(instanceId);
                    const statsB = b.instanceStats.get(instanceId);
                    const firstSeenA = statsA?.firstJoinAt?.getTime() ?? 0;
                    const firstSeenB = statsB?.firstJoinAt?.getTime() ?? 0;
                    return firstSeenA - firstSeenB;
                },
            },
        );
    } else {
        columns.push(
            {
                title: "Online time",
                key: "onlineTime",
                render: (_: any, user: lib.User) =>
                    user.playerStats?.onlineTimeMs ? formatDuration(user.playerStats.onlineTimeMs) : null,
                sorter: (a: lib.User, b: lib.User) => (a.playerStats?.onlineTimeMs ?? 0) - (b.playerStats?.onlineTimeMs ?? 0),
                responsive: ["lg"],
            },
            {
                title: "First seen",
                key: "firstSeen",
                render: (_: any, user: lib.User) => formatFirstSeen(user),
                sorter: (a: lib.User, b: lib.User) => sortFirstSeen(a, b),
            },
            {
                title: "Last seen",
                key: "lastSeen",
                render: (_: any, user: lib.User) => formatLastSeen(user),
                sorter: (a: lib.User, b: lib.User) => sortLastSeen(a, b),
                responsive: ["lg"],
            },
        );
    }

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
