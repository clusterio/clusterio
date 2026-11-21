import React, { useEffect, useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	Button, Descriptions, Dropdown, Input, Popconfirm, Table, Tag, Select, Space, Switch,
} from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import DownOutlined from "@ant-design/icons/DownOutlined";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import useTableQueryState from "../util/useTableQueryState";
import { useAccount } from "../model/account";
import { useInstances } from "../model/instance";
import ControlContext from "./ControlContext";
import FieldRow from "./FieldRow";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import SectionHeader from "./SectionHeader";
import ResourceNotes from "./ResourceNotes";
import ResourceState from "./ResourceState";
import UnsavedChangesBar from "./UnsavedChangesBar";
import useRowNavigation from "../util/useRowNavigation";
import useResourceState from "../util/useResourceState";
import usePluginActions from "../util/usePluginActions";
import Link from "./Link";
import notify, { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import { formatFirstSeen, formatLastSeen, sortFirstSeen, sortLastSeen, useUser } from "../model/user";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function sameIds(ids: number[], set: Set<number>) {
	return ids.length === set.size && ids.every(id => set.has(id));
}


function UserPluginActions(props: { user: lib.UserDetails }) {
	const pluginActions = usePluginActions("UserViewPage", { user: props.user });
	if (!pluginActions.length) {
		return null;
	}
	return <Dropdown placement="bottomRight" trigger={["click"]} menu={{ items: pluginActions }}>
		<Button>More <DownOutlined /></Button>
	</Dropdown>;
}

// The user page has a lot of optional elements, that does not make it
// praticularly complicated.
// eslint-disable-next-line complexity
export default function UserViewPage() {
	let params = useParams();
	let userName = params.name as string;

	let navigate = useNavigate();
	const rowNav = useRowNavigation();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [instances] = useInstances();
	const [user, synced, error] = useUser(userName);
	const state = useResourceState(user, synced, error, userName);
	let [roles, rolesSynced] = useRoles();
	const statsTable = useTableQueryState<[number, lib.PlayerStats]>({
		namespace: "stats", defaultSortKey: "instance",
	});
	// Local edits on top of the live user
	const [rolesEdit, setRolesEdit] = useState<number[]>();
	const [bannedEdit, setBannedEdit] = useState<boolean>();
	const [banReasonEdit, setBanReasonEdit] = useState<string>();
	const [applying, setApplying] = useState(false);
	const canUpdateRoles = account.hasPermission("core.user.update_roles");
	const canBan = account.hasPermission("core.user.set_banned");
	const canSetAdmin = account.hasPermission("core.user.set_admin");
	const canSetWhitelisted = account.hasPermission("core.user.set_whitelisted");

	// Drop edits that now match the user, and roles deleted since
	useEffect(() => {
		if (!user) {
			return;
		}
		setRolesEdit(prev => {
			const next = prev?.filter(id => !rolesSynced || roles.has(id));
			return next && sameIds(next, user.roleIds) ? undefined : next;
		});
		setBannedEdit(prev => (prev === user.isBanned ? undefined : prev));
		setBanReasonEdit(prev => (prev === user.banReason ? undefined : prev));
	}, [user, roles, rolesSynced]);

	useEffect(() => {
		setRolesEdit(undefined);
		setBannedEdit(undefined);
		setBanReasonEdit(undefined);
	}, [userName]);

	let nav = [{ name: "Users", path: "/users" }, { name: userName }];
	if (!user) {
		return <ResourceState state={state} type="User" id={userName} nav={nav} listPath="/users" error={error} />;
	}

	const roleIds = rolesEdit ?? [...user.roleIds];
	const banned = bannedEdit ?? user.isBanned;
	const banReason = banned ? banReasonEdit ?? user.banReason : "";
	const rolesChanged = rolesEdit !== undefined && !sameIds(rolesEdit, user.roleIds);
	const banChanged = banned !== user.isBanned || banReason !== user.banReason;

	function revertChanges() {
		setRolesEdit(undefined);
		setBannedEdit(undefined);
		setBanReasonEdit(undefined);
	}

	async function applyChanges() {
		if (rolesChanged) {
			await control.send(new lib.UserUpdateRolesRequest(userName, roleIds));
			setRolesEdit(undefined);
		}
		if (banChanged) {
			await control.send(new lib.UserSetBannedRequest(userName, false, banned, banReason));
			setBannedEdit(undefined);
			setBanReasonEdit(undefined);
		}
	}

	function instanceName(id: number) {
		return instances.get(id)?.name ?? String(id);
	}

	return <PageLayout nav={nav}>
		<PageHeader
			title={<Space>
				{userName}
				<span>
					{user.isAdmin && <Tag color="gold">Admin</Tag>}
					{user.isWhitelisted && <Tag>Whitelisted</Tag>}
					{user.isBanned && <Tag color="red">Banned</Tag>}
				</span>
			</Space>}
			extra={<Space wrap>
				{account.hasPermission("core.user.revoke_token") && (
					account.name === userName || account.hasPermission("core.user.revoke_other_token")
				) && <Button
					danger
					onClick={() => {
						control.send(
							new lib.UserRevokeTokenRequest(userName)
						).then(() => {
							notify("User token revoked");
						}, err => {
							if (err instanceof lib.SessionLost && userName === account.name) {
								// Got kicked out after revoking our own token
								notify("User token revoked");
								return;
							}
							throw err;
						}).catch(notifyErrorHandler("Error revoking token"));
					}}
				>Revoke token</Button>}
				{account.hasPermission("core.user.delete") && <Popconfirm
					title={<>
						Delete user account and all data associated with it?
						{(user.isBanned && <><br/>This will remove the user ban!</>)}
					</>}
					placement="bottomRight"
					okText="Delete"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						control.send(
							new lib.UserDeleteRequest(userName)
						).then(() => {
							navigate("/users");
						}, err => {
							if (err instanceof lib.SessionLost && userName === account.name) {
								// Got kicked out after deleting our own account
								navigate("/users");
								return;
							}
							throw err;
						}).catch(notifyErrorHandler("Error deleting user"));
					}}
				>
					<Button danger >
						<DeleteOutlined />
					</Button>
				</Popconfirm>}
				<UserPluginActions user={user} />
			</Space>}
		/>
		{(rolesChanged || banChanged) && <UnsavedChangesBar
			applying={applying}
			onRevert={revertChanges}
			onApply={() => {
				setApplying(true);
				applyChanges()
					.catch(notifyErrorHandler("Error applying changes"))
					.finally(() => setApplying(false));
			}}
		/>}
		<FieldRow label="Roles">
			<Select
				style={{ width: "100%" }}
				mode="multiple"
				disabled={!canUpdateRoles}
				value={roleIds}
				onChange={setRolesEdit}
				optionFilterProp="label"
				options={[...roles.values()].map(r => ({ value: r.id, label: r.name }))}
			/>
		</FieldRow>
		{(canSetAdmin || canSetWhitelisted || canBan) && <FieldRow label="Status">
			<Space size="large" wrap>
				{canSetAdmin && <label><Space>
					In-game Admin
					<Switch
						checked={user.isAdmin}
						onClick={() => {
							control.send(
								new lib.UserSetAdminRequest(userName, false, !user.isAdmin)
							).catch(notifyErrorHandler("Error toggling user admin status"));
						}}
					/>
				</Space></label>}
				{canSetWhitelisted && <label><Space>
					Whitelisted
					<Switch
						checked={user.isWhitelisted}
						onClick={() => {
							control.send(
								new lib.UserSetWhitelistedRequest(userName, false, !user.isWhitelisted)
							).catch(notifyErrorHandler("Error toggling user whitelisted status"));
						}}
					/>
				</Space></label>}
				{canBan && <label><Space>
					Banned
					<Switch checked={banned} onClick={() => setBannedEdit(!banned)} />
				</Space></label>}
			</Space>
		</FieldRow>}
		{banned && <FieldRow label="Ban reason">
			<Input
				value={banReason}
				disabled={!canBan}
				onChange={e => setBanReasonEdit(e.target.value)}
			/>
		</FieldRow>}
		<ResourceNotes resourceType="user" resourceId={user.id} />
		<SectionHeader title="Player stats" />
		<Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 2 }}>
			<Descriptions.Item label="Total online time">
				{formatDuration(user.playerStats?.onlineTimeMs ?? 0)}
			</Descriptions.Item>
			<Descriptions.Item label="Total join count">
				{user.playerStats?.joinCount ?? 0}
			</Descriptions.Item>
			<Descriptions.Item label="First seen">
				{formatFirstSeen(user) || " "}
			</Descriptions.Item>
			<Descriptions.Item label="Last seen">
				{formatLastSeen(user) || " "}
			</Descriptions.Item>
		</Descriptions>
		<SectionHeader title="Instance stats" />
		<Table
			size="small"
			columns={[
				{
					title: "Instance",
					key: "instance",
					className: "table-link-cell",
					render: (_, [id]) => <Link to={`/instances/${id}/view`} style={{ color: "inherit" }}>
						{instanceName(id)}
					</Link>,
					sorter: (a, b) => strcmp(instanceName(a[0]), instanceName(b[0])),
					sortOrder: statsTable.sortOrder("instance"),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: (_, [, stats]) => formatDuration(stats.onlineTimeMs || 0),
					sorter: (a, b) => (a[1].onlineTimeMs || 0) - (b[1].onlineTimeMs || 0),
					sortOrder: statsTable.sortOrder("onlineTime"),
				},
				{
					title: "Join count",
					key: "joinCoint",
					render: (_, [, stats]) => stats.joinCount || 0,
					sorter: (a, b) => (a[1].joinCount || 0) - (b[1].joinCount || 0),
					sortOrder: statsTable.sortOrder("joinCoint"),
					responsive: ["sm"],
				},
				{
					title: "First seen",
					key: "firstSeen",
					render: (_, [id]) => formatFirstSeen(user, id),
					sorter: (a, b) => sortFirstSeen(user, user, a[0], b[0]),
					sortOrder: statsTable.sortOrder("firstSeen"),
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: (_, [id]) => formatLastSeen(user, id),
					sorter: (a, b) => sortLastSeen(user, user, a[0], b[0]),
					sortOrder: statsTable.sortOrder("lastSeen"),
				},
			]}
			dataSource={[...(user.instanceStats || []).entries()]}
			pagination={statsTable.pagination}
			onChange={statsTable.onChange}
			rowKey={([id]) => id}
			onRow={([id]) => rowNav(`/instances/${id}/view`)}
		/>
		<PluginExtra component="UserViewPage" user={user} />
	</PageLayout>;
}
