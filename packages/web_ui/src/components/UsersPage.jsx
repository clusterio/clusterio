import React, { useEffect, useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Space, Table, Tag } from "antd";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { formatLastSeen, sortLastSeen, useUserList } from "../model/user";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function CreateUserButton() {
	let control = useContext(ControlContext);
	let history = useHistory();
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	async function createUser() {
		let values = form.getFieldsValue();
		if (!values.userName) {
			form.setFields([{ name: "userName", errors: ["Name is required"] }]);
			return;
		}

		await libLink.messages.createUser.send(control, { name: values.userName });
		setVisible(false);
		history.push(`/users/${values.userName}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => { setVisible(true); }}
		>Create</Button>
		<Modal
			title="Create User"
			okText="Create"
			visible={visible}
			onOk={() => { createUser().catch(notifyErrorHandler("Error creating user")); }}
			onCancel={() => { setVisible(false); }}
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
	let history = useHistory();
	let [userList] = useUserList();

	let [roles, setRoles] = useState(new Map());

	useEffect(() => {
		libLink.messages.listRoles.send(control).then(result => {
			setRoles(new Map(result["list"].map(role => [role["id"], role])));
		}).catch(() => {
			// ignore
		});
	}, []);

	return <PageLayout nav={[{ name: "Users" }]}>
		<PageHeader
			className="site-page-header"
			title="Users"
			extra={account.hasPermission("core.user.create") && <CreateUserButton />}
		/>
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					render: user => <Space>
						{user["name"]}
						<span>
							{user["is_admin"] && <Tag color="gold">Admin</Tag>}
							{user["is_whitelisted"] && <Tag>Whitelisted</Tag>}
							{user["is_banned"] && <Tag color="red">Banned</Tag>}
						</span>
					</Space>,
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a["name"], b["name"]),
				},
				{
					title: "Roles",
					key: "roles",
					render: user => user.roles.map(id => <Tag key={id}>{(roles.get(id) || { name: id })["name"]}</Tag>),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: user => user["player_stats"]["online_time_ms"]
						&& formatDuration(user["player_stats"]["online_time_ms"]),
					sorter: (a, b) => (a["player_stats"]["online_time_ms"] || 0) -
						(b["player_stats"]["online_time_ms"] || 0),
					responsive: ["lg"],
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: user => formatLastSeen(user),
					sorter: (a, b) => sortLastSeen(a, b),
					responsive: ["lg"],
				},
			]}
			dataSource={userList}
			pagination={false}
			rowKey={user => user["name"]}
			onRow={(user, rowIndex) => ({
				onClick: event => {
					history.push(`/users/${user["name"]}/view`);
				},
			})}
		/>
		<PluginExtra component="UsersPage" />
	</PageLayout>;
}
