import React, { useEffect, useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Button, Col, Form, Input, PageHeader, Popconfirm, Popover, Row, Tag, Select, Space, Spin, Switch } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { notifyErrorHandler } from "../util/notify";


function useUser(name) {
	let control = useContext(ControlContext);
	let [user, setUser] = useState({ loading: true });

	function updateUser() {
		// XXX optimize by requesting only the user in question
		libLink.messages.listUsers.send(control).then(result => {
			let match = result.list.find(u => u.name === name);
			if (!match) {
				setUser({ missing: true });
			} else {
				setUser({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		updateUser();
	}, [name]);

	return [user, updateUser];
}

export default function UserViewPage() {
	let params = useParams();
	let userName = params.name;

	let history = useHistory();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [user, updateUser] = useUser(userName);
	let [roles, setRoles] = useState(null);
	let [form] = Form.useForm();
	let [rolesDirty, setRolesDirty] = useState(false);
	let [applyingRoles, setApplyingRoles] = useState(false);
	let [rolesError, setRolesError] = useState();
	let [banUserPopover, setBanUserPopover] = useState(false);

	useEffect(() => {
		libLink.messages.listRoles.send(control).then(result => {
			setRoles(new Map(result["list"].map(role => [role["id"], role])));
		}).catch(() => {
			setRoles(new Map());
		});
	}, []);

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

	return <PageLayout nav={nav}>
		<PageHeader
			className="site-page-header"
			title={userName}
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
		<Form form={form}>
			<Form.Item
				label="Roles"
			>
				<Row gutter={8}>
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
			<Form.Item label="In-game Admin">
				<Switch
					checked={user["is_admin"]}
					disabled={!account.hasPermission("core.user.set_admin")}
					onClick={() => {
						libLink.messages.setUserAdmin.send(control, {
							name: userName,
							admin: !user["is_admin"],
							create: false,
						}).then(() => {
							updateUser();
						}).catch(notifyErrorHandler("Error toggling user admin status"));
					}}
				/>
			</Form.Item>
			<Form.Item label="Whitelisted">
				<Switch
					checked={user["is_whitelisted"]}
					disabled={!account.hasPermission("core.user.set_whitelisted")}
					onClick={() => {
						libLink.messages.setUserWhitelisted.send(control, {
							name: userName,
							whitelisted: !user["is_whitelisted"],
							create: false,
						}).then(() => {
							updateUser();
						}).catch(notifyErrorHandler("Error toggling user whitelisted status"));
					}}
				/>
			</Form.Item>
			<Form.Item label="Banned">
				<Space>
					{user["is_banned"] ? "Yes" : "No"}
					{account.hasPermission("core.user.set_banned") && <Popover
						title="Ban user"
						visible={banUserPopover}
						trigger="click"
						onVisibleChange={() => {
							if (!user["is_banned"]) {
								setBanUserPopover(!banUserPopover);
							}
						}}
						content={<Form.Item label="Reason">
							<Row gutter={8}>
								<Col flex="auto">
									<Form.Item noStyle name="reason">
										<Input/>
									</Form.Item>
								</Col>
								<Col flex="0 0 auto">
									<Button
										type="primary"
										onClick={() => {
											let reason = form.getFieldValue("reason");
											libLink.messages.setUserBanned.send(control, {
												name: userName,
												create: false,
												banned: true,
												reason,
											}).then(() => {
												setBanUserPopover(false);
												updateUser();
											}).catch(notifyErrorHandler("Error banning user"));
										}}
									>Ban</Button>
								</Col>
							</Row>
						</Form.Item>}
					>
						<Button
							type="primary"
							size="small"
							onClick={() => {
								if (user["is_banned"]) {
									libLink.messages.setUserBanned.send(control, {
										name: userName,
										create: false,
										banned: false,
										reason: "",
									}).then(() => {
										updateUser();
									}).catch(notifyErrorHandler("Error pardoning user"));
								}
							}}
						>{user["is_banned"] ? "Pardon User" : "Ban User"}</Button>
					</Popover>}
				</Space>
			</Form.Item>
		</Form>
	</PageLayout>;
}
