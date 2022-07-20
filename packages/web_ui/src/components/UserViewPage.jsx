import React, { useEffect, useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
	Button, Col, Descriptions, Form, Input, PageHeader, Popconfirm,
	Row, Table, Tag, Select, Space, Spin, Switch,
} from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useInstanceList } from "../model/instance";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import SectionHeader from "./SectionHeader";
import { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import { formatLastSeen, sortLastSeen, useUser } from "../model/user";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


// The user page has a lot of optional elements, that does not make it
// praticularly complicated.
// eslint-disable-next-line complexity
export default function UserViewPage() {
	let params = useParams();
	let userName = params.name;

	let history = useHistory();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [instanceList] = useInstanceList();
	let [user] = useUser(userName);
	let [roles, setRoles] = useState(null);
	let [form] = Form.useForm();
	let [rolesDirty, setRolesDirty] = useState(false);
	let [banReasonDirty, setBanReasonDirty] = useState(false);
	let [applyingRoles, setApplyingRoles] = useState(false);
	let [rolesError, setRolesError] = useState();

	useEffect(() => {
		libLink.messages.listRoles.send(control).then(result => {
			setRoles(new Map(result["list"].map(role => [role["id"], role])));
		}).catch(() => {
			setRoles(new Map());
		});
	}, []);

	useEffect(() => {
		if (
			account.hasPermission("core.user.set_banned")
			&& !banReasonDirty
			&& user["ban_reason"] !== form.getFieldValue("ban_reason")
		) {
			form.setFieldsValue({ "ban_reason": user["ban_reason"] });
		}
	}, [account, form, user, banReasonDirty]);

	let nav = [{ name: "Users", path: "/users" }, { name: userName }];
	if (user.loading) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title={userName}
			/>
			<Spin size="large" />
		</PageLayout>;
	}

	if (user.missing) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title="User not found"
			/>
			<p>User with name {userName} was not found on the master server.</p>
		</PageLayout>;
	}

	let roleSelector = <Form.Item
		noStyle
		name="roles"
		initialValue={user["roles"]}
		rules={[
			{ validator: () => (rolesError ? Promise.reject(rolesError) : Promise.resolve()) },
		]}
	>
		<Select
			onChange={() => setRolesDirty(true)}
			loading={!roles}
			mode="multiple"
			showArrow={true}
			filterOption={(inputValue, option) => {
				let role = roles.get(option.value);
				return role && role["name"].toLowerCase().includes(inputValue.toLowerCase());
			}}
		>
			{roles && [...roles.values()].map(r => <Select.Option
				key={r["id"]}
				value={r["id"]}
			>{r["name"]}</Select.Option>)}
		</Select>
	</Form.Item>;

	function instanceName(id) {
		let instance = instanceList.find(i => i.id === id);
		return instance ? instance["name"] : id;
	}

	return <PageLayout nav={nav}>
		<PageHeader
			className="site-page-header"
			title={<Space>
				{userName}
				<span>
					{user["is_admin"] && <Tag color="gold">Admin</Tag>}
					{user["is_whitelisted"] && <Tag>Whitelisted</Tag>}
					{user["is_banned"] && <Tag color="red">Banned</Tag>}
				</span>
			</Space>}
			extra={
				account.hasPermission("core.user.delete") && <Popconfirm
					title={<>
						Delete user account and all data associated with it?
						{(user["is_banned"] && <><br/>This will remove the user ban!</>)}
					</>}
					placement="bottomRight"
					okText="Delete"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						libLink.messages.deleteUser.send(
							control, { name: userName }
						).then(() => {
							history.push("/users");
						}).catch(notifyErrorHandler("Error deleting user"));
					}}
				>
					<Button danger >
						<DeleteOutlined />
					</Button>
				</Popconfirm>
			}
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
							: [...user["roles"]].map(id => <Tag key={id}>{
								roles ? (roles.get(id) || { name: id })["name"] : id
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
								libLink.messages.updateUserRoles.send(control, {
									name: userName,
									roles: newRoles,
								}).then(() => {
									setRolesDirty(false);
									setRolesError();
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
					checked={user["is_admin"]}
					onClick={() => {
						libLink.messages.setUserAdmin.send(control, {
							name: userName,
							admin: !user["is_admin"],
							create: false,
						}).catch(notifyErrorHandler("Error toggling user admin status"));
					}}
				/>
			</Form.Item>}
			{account.hasPermission("core.user.set_whitelisted") && <Form.Item label="Whitelisted">
				<Switch
					checked={user["is_whitelisted"]}
					onClick={() => {
						libLink.messages.setUserWhitelisted.send(control, {
							name: userName,
							whitelisted: !user["is_whitelisted"],
							create: false,
						}).catch(notifyErrorHandler("Error toggling user whitelisted status"));
					}}
				/>
			</Form.Item>}
			{account.hasPermission("core.user.set_banned")
				? <Form.Item label="Ban reason">
					<Row gutter={[8, 8]} justify={"end"}>
						<Col flex="auto" style={{ minWidth: "20em" }}>
							<Form.Item noStyle name="ban_reason" initialValue={user["ban_reason"]}>
								<Input
									onChange={e => {
										setBanReasonDirty(e.target.value !== user["ban_reason"]);
									}}
								/>
							</Form.Item>
						</Col>
						<Col flex="0 0 auto">
							{user["is_banned"]
								? <Space>
									<Button
										type={banReasonDirty ? "primary" : "default"}
										onClick={() => {
											libLink.messages.setUserBanned.send(control, {
												name: userName,
												create: false,
												banned: true,
												reason: form.getFieldValue("ban_reason"),
											}).then(() => {
												setBanReasonDirty(false);
											}).catch(notifyErrorHandler("Error updating ban"));
										}}
									>Update</Button>
									<Button
										onClick={() => {
											libLink.messages.setUserBanned.send(control, {
												name: userName,
												create: false,
												banned: false,
												reason: "",
											}).catch(notifyErrorHandler("Error unbanning user"));
										}}
									>Unban</Button>
								</Space>
								: <Button
									type={banReasonDirty ? "primary" : "default"}
									onClick={() => {
										libLink.messages.setUserBanned.send(control, {
											name: userName,
											create: false,
											banned: true,
											reason: form.getFieldValue("ban_reason"),
										}).then(() => {
											setBanReasonDirty(false);
										}).catch(notifyErrorHandler("Error banning user"));
									}}
								>Ban</Button>
							}
						</Col>
					</Row>
				</Form.Item>
				: user["is_banned"]
					&& <Form.Item label="Ban reason">{user["ban_reason"]}</Form.Item>
			}
		</Form>
		<SectionHeader title="Player stats" />
		<Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }}>
			<Descriptions.Item label="Total online time">
				{formatDuration(user["player_stats"]["online_time_ms"] || 0)}
			</Descriptions.Item>
			<Descriptions.Item label="Total join count">
				{user["player_stats"]["join_count"] || 0}
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
					sorter: (a, b) => strcmp(a[0], b[0]),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: ([, stats]) => formatDuration(stats["online_time_ms"] || 0),
					sorter: (a, b) => (a[1]["online_time_ms"] || 0) - (b[1]["online_time_ms"] || 0),
				},
				{
					title: "Join count",
					key: "joinCoint",
					render: ([, stats]) => stats["join_count"] || 0,
					sorter: (a, b) => (a[1]["join_count"] || 0) - (b[1]["join_count"] || 0),
					responsive: ["sm"],
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: ([id]) => formatLastSeen(user, id),
					sorter: (a, b) => sortLastSeen(user, user, a[0], b[0]),
				},
			]}
			dataSource={user["instance_stats"]}
			pagination={false}
			rowKey={([id]) => id}
			onRow={([id], rowIndex) => ({
				onClick: event => {
					history.push(`/instances/${id}/view`);
				},
			})}
		/>
		<PluginExtra component="UserViewPage" user={user} />
	</PageLayout>;
}
