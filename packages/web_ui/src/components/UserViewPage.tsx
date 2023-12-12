import React, { useEffect, useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	Button, Col, Descriptions, Form, Input, Popconfirm,
	Row, Table, Tag, Select, Space, Spin, Switch,
} from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useInstances } from "../model/instance";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import SectionHeader from "./SectionHeader";
import notify, { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import { formatLastSeen, sortLastSeen, useUser } from "../model/user";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


// The user page has a lot of optional elements, that does not make it
// praticularly complicated.
// eslint-disable-next-line complexity
export default function UserViewPage() {
	let params = useParams();
	let userName = params.name as string;

	let navigate = useNavigate();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [instances] = useInstances();
	const [user, synced] = useUser(userName);
	let [roles, setRoles] = useState<Map<number, lib.Role>>(new Map());
	let [form] = Form.useForm();
	let [rolesDirty, setRolesDirty] = useState<boolean>(false);
	let [banReasonDirty, setBanReasonDirty] = useState<boolean>(false);
	let [applyingRoles, setApplyingRoles] = useState<boolean>(false);
	let [rolesError, setRolesError] = useState<string|undefined>();

	useEffect(() => {
		control.send(new lib.RoleListRequest()).then(newRoles => {
			setRoles(new Map(newRoles.map(role => [role.id, role])));
		}).catch(() => {
			setRoles(new Map());
		});
	}, []);

	useEffect(() => {
		if (
			account.hasPermission("core.user.set_banned")
			&& !banReasonDirty
			&& user
			&& user.banReason !== form.getFieldValue("banReason")
		) {
			form.setFieldsValue({ "banReason": user.banReason });
		}
	}, [account, form, user, banReasonDirty]);

	let nav = [{ name: "Users", path: "/users" }, { name: userName }];
	if (!user) {
		if (!synced) {
			return <PageLayout nav={nav}>
				<PageHeader title={userName} />
				<Spin size="large" />
			</PageLayout>;
		}

		return <PageLayout nav={nav}>
			<PageHeader title="User not found" />
			<p>User with name {userName} was not found on the controller.</p>
		</PageLayout>;
	}

	let roleSelector = <Form.Item
		noStyle
		name="roles"
		initialValue={[...user.roleIds]}
		rules={[
			{ validator: () => (rolesError ? Promise.reject(rolesError) : Promise.resolve()) },
		]}
	>
		<Select
			onChange={() => setRolesDirty(true)}
			loading={!roles}
			mode="multiple"
			showArrow={true}
			filterOption={(inputValue:string, option: any): boolean => {
				let role = roles.get(option.value);
				return role?.name.toLowerCase().includes(inputValue.toLowerCase()) ?? false;
			}}
		>
			{[...roles.values()].map(r => <Select.Option
				key={r.id}
				value={r.id}
			>{r.name}</Select.Option>)}
		</Select>
	</Form.Item>;

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
			extra={<>
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
						}).catch(notifyErrorHandler("Error deleting user"));
					}}
				>
					<Button danger >
						<DeleteOutlined />
					</Button>
				</Popconfirm>}
			</>}
		/>
		<Form
			form={form}
			labelCol={{
				sm: { span: 6 },
				md: { span: 6 },
				lg: { span: 4 },
				xl: { span: 3 },
				xxl: { span: 2 },
			}}
			wrapperCol={{
				sm: { span: 18 },
				md: { span: 18 },
				lg: { span: 20 },
				xl: { span: 21 },
				xxl: { span: 22 },
			}}
		>
			<Form.Item
				label="Roles"
			>
				<Row gutter={[8, 8]}>
					<Col flex="auto">
						{account.hasPermission("core.user.update_roles")
							? roleSelector
							: [...user.roleIds!].map(id => <Tag key={id}>{
								roles?.get(id)?.name ?? id
							}</Tag>)
						}
					</Col>
					{account.hasPermission("core.user.update_roles") && <Col flex="0 0 auto">
						<Button
							type={"primary"}
							disabled={!rolesDirty}
							loading={applyingRoles}
							onClick={() => {
								let newRoles = form.getFieldValue("roles");
								setApplyingRoles(true);
								control.send(
									new lib.UserUpdateRolesRequest(userName, newRoles)
								).then(() => {
									setRolesDirty(false);
									setRolesError(undefined);
								}).catch(err => {
									setRolesError(err.message);
									return form.validateFields();
								}).finally(() => {
									setApplyingRoles(false);
								});
							}}
						>Apply</Button>
					</Col>}
				</Row>
			</Form.Item>
			{account.hasPermission("core.user.set_admin") && <Form.Item label="In-game Admin">
				<Switch
					checked={user.isAdmin}
					onClick={() => {
						control.send(
							new lib.UserSetAdminRequest(userName, false, !user.isAdmin)
						).catch(notifyErrorHandler("Error toggling user admin status"));
					}}
				/>
			</Form.Item>}
			{account.hasPermission("core.user.set_whitelisted") && <Form.Item label="Whitelisted">
				<Switch
					checked={user.isWhitelisted}
					onClick={() => {
						control.send(
							new lib.UserSetWhitelistedRequest(userName, false, !user.isWhitelisted)
						).catch(notifyErrorHandler("Error toggling user whitelisted status"));
					}}
				/>
			</Form.Item>}
			{account.hasPermission("core.user.set_banned")
				? <Form.Item label="Ban reason">
					<Row gutter={[8, 8]} justify={"end"}>
						<Col flex="auto" style={{ minWidth: "20em" }}>
							<Form.Item noStyle name="banReason" initialValue={user.banReason}>
								<Input
									onChange={e => {
										setBanReasonDirty(e.target.value !== user.banReason);
									}}
								/>
							</Form.Item>
						</Col>
						<Col flex="0 0 auto">
							{user.isBanned
								? <Space>
									<Button
										type={banReasonDirty ? "primary" : "default"}
										onClick={() => {
											control.send(
												new lib.UserSetBannedRequest(
													userName, false, true, form.getFieldValue("banReason")
												)
											).then(() => {
												setBanReasonDirty(false);
											}).catch(notifyErrorHandler("Error updating ban"));
										}}
									>Update</Button>
									<Button
										onClick={() => {
											control.send(
												new lib.UserSetBannedRequest(userName, false, false, "")
											).catch(notifyErrorHandler("Error unbanning user"));
										}}
									>Unban</Button>
								</Space>
								: <Button
									type={banReasonDirty ? "primary" : "default"}
									onClick={() => {
										control.send(
											new lib.UserSetBannedRequest(
												userName, false, true, form.getFieldValue("banReason")
											)
										).then(() => {
											setBanReasonDirty(false);
										}).catch(notifyErrorHandler("Error banning user"));
									}}
								>Ban</Button>
							}
						</Col>
					</Row>
				</Form.Item>
				: user.isBanned
					&& <Form.Item label="Ban reason">{user.banReason}</Form.Item>
			}
		</Form>
		<SectionHeader title="Player stats" />
		<Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }}>
			<Descriptions.Item label="Total online time">
				{formatDuration(user.playerStats?.onlineTimeMs ?? 0)}
			</Descriptions.Item>
			<Descriptions.Item label="Total join count">
				{user.playerStats?.joinCount ?? 0}
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
					render: ([id]) => instanceName(id),
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(instanceName(a[0]), instanceName(b[0])),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: ([, stats]) => formatDuration(stats.onlineTimeMs || 0),
					sorter: (a, b) => (a[1].onlineTimeMs || 0) - (b[1].onlineTimeMs || 0),
				},
				{
					title: "Join count",
					key: "joinCoint",
					render: ([, stats]) => stats.joinCount || 0,
					sorter: (a, b) => (a[1].joinCount || 0) - (b[1].joinCount || 0),
					responsive: ["sm"],
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: ([id]) => formatLastSeen(user, id),
					sorter: (a, b) => sortLastSeen(user, user, a[0], b[0]),
				},
			]}
			dataSource={[...(user.instanceStats || []).entries()]}
			pagination={false}
			rowKey={([id]) => id}
			onRow={([id], rowIndex) => ({
				onClick: event => {
					navigate(`/instances/${id}/view`);
				},
			})}
		/>
		<PluginExtra component="UserViewPage" user={user} />
	</PageLayout>;
}
