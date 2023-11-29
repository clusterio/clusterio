import React, { useEffect, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Space, Table, Tag } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { formatLastSeen, sortLastSeen, useUserList } from "../model/user";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


function CreateUserButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	async function createUser() {
		let values = form.getFieldsValue();
		if (!values.userName) {
			form.setFields([{ name: "userName", errors: ["Name is required"] }]);
			return;
		}

		await control.send(new lib.UserCreateRequest(values.userName));
		setOpen(false);
		navigate(`/users/${values.userName}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => { setOpen(true); }}
		>Create</Button>
		<Modal
			title="Create User"
			okText="Create"
			open={open}
			onOk={() => { createUser().catch(notifyErrorHandler("Error creating user")); }}
			onCancel={() => { setOpen(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="userName" label="Name">
					<Input/>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function UsersPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [userList] = useUserList();

	let [roles, setRoles] = useState(new Map());

	useEffect(() => {
		control.send(new lib.RoleListRequest()).then(newRoles => {
			setRoles(new Map(newRoles.map(role => [role.id, role])));
		}).catch(() => {
			// ignore
		});
	}, []);

	return <PageLayout nav={[{ name: "Users" }]}>
		<PageHeader
			title="Users"
			extra={account.hasPermission("core.user.create") && <CreateUserButton /> || undefined}
		/>
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					render: (user: lib.User) => <Space>
						{user.name}
						<span>
							{user.isAdmin && <Tag color="gold">Admin</Tag>}
							{user.isWhitelisted && <Tag>Whitelisted</Tag>}
							{user.isBanned && <Tag color="red">Banned</Tag>}
						</span>
					</Space>,
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "Roles",
					key: "roles",
					render: (user: lib.User) => (
						[...user.roleIds].map(id => <Tag key={id}>{(roles.get(id) || { name: id }).name}</Tag>)
					),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: (user: lib.User) => (user.playerStats?.onlineTimeMs
						? formatDuration(user.playerStats.onlineTimeMs) : null),
					sorter: (a, b) => (a.playerStats?.onlineTimeMs ?? 0) -
						(b.playerStats?.onlineTimeMs ?? 0),
					responsive: ["lg"],
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: (user: lib.User) => formatLastSeen(user),
					sorter: (a, b) => sortLastSeen(a, b),
					responsive: ["lg"],
				},
			]}
			dataSource={userList}
			pagination={false}
			rowKey={user => user.name}
			onRow={(user, rowIndex) => ({
				onClick: event => {
					navigate(`/users/${user.name}/view`);
				},
			})}
		/>
		<PluginExtra component="UsersPage" />
	</PageLayout>;
}
