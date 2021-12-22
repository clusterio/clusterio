import React, { useEffect, useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table, Tag } from "antd";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import PageLayout from "./PageLayout";

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
// Group of functions to read from a file and run a bulk import using the content from the file
async function bulkAdmin (e, control) {
	e.preventDefault();
	const reader = new FileReader();
	reader.onload = async (k) => {
		const text = (k.target.result);
		let names = text.split("\n");
		await names.forEach(async (name) => {
			if (name !== "") {
				await libLink.messages.setUserAdmin.send(control, {
					name: name, create: true, admin: true,
				});
			}
		});
	};
    	await reader.readAsText(e.target.files[0]);
}

async function bulkWhitelist (e, control) {
	e.preventDefault();
	const reader = new FileReader();
	reader.onload = async (k) => {
		const text = (k.target.result);
		let names = text.split("\n");
		await names.forEach(async (name) => {
			if (name !== "") {
				await libLink.messages.setUserWhitelisted.send(control, {
					name: name, create: true, whitelisted: true,
				});
			}
		});
	};
    	await reader.readAsText(e.target.files[0]);
}

async function bulkBanned (e, control) {
	e.preventDefault();
	const reader = new FileReader();
	reader.onload = async (k) => {
		const text = k.target.result;
		let names = text.split("\n");
		await names.forEach(async (part) => {
			if (part !== "") {
				let namereason = part.split(" ");
				await libLink.messages.setUserBanned.send(control, {
					name: namereason[0],
					create: true,
					banned: true,
					reason: namereason.slice(1, namereason.length).join(" "),
				});
			}
		});
		return 0;
	};
    	await reader.readAsText(e.target.files[0]);
}

export default function UsersPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let history = useHistory();

	let [users, setUsers] = useState([]);
	let [roles, setRoles] = useState(new Map());

	useEffect(() => {
		libLink.messages.listUsers.send(control).then(result => {
			setUsers(result["list"]);
		}).catch(notifyErrorHandler("Error fetching user list"));
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
					dataIndex: "name",
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a["name"], b["name"]),
				},
				{
					title: "Roles",
					key: "roles",
					render: user => user.roles.map(id => <Tag key={id}>{(roles.get(id) || { name: id })["name"]}</Tag>),
				},
				{
					title: "Admin",
					key: "admin",
					render: user => user["is_admin"] && "yes",
					sorter: (a, b) => a["is_admin"] - b["is_admin"],
					responsive: ["lg"],
				},
				{
					title: "Whitelisted",
					key: "whitelisted",
					render: user => user["is_whitelisted"] && "yes",
					sorter: (a, b) => a["is_whitelisted"] - b["is_whitelisted"],
					responsive: ["lg"],
				},
				{
					title: "Banned",
					key: "banned",
					render: user => user["is_banned"] && "yes" ||,
					sorter: (a, b) => a["is_banned"] - b["is_banned"],
					responsive: ["lg"],
				},
			]}
			dataSource={users}
			pagination={false}
			rowKey={user => user["name"]}
			onRow={(user, rowIndex) => ({
				onClick: event => {
					history.push(`/users/${user["name"]}/view`);
				},
			})}
		/>
		<div style={{padding: "20px"}}>
			<span style={{padding: "20px"}}>
				<Button>
					<label htmlFor="admin-file-select">
						Bulk Admin Import
					</label>
				</Button>
			</span>
			<input id="admin-file-select" type="file"
				style={{display: "none"}}
				onChange={(e) => bulkAdmin(e, control)}
			/>
			<span style={{padding: "20px"}}>
				<Button>
					<label htmlFor="whitelist-file-select">
						Bulk Whitelist Import
					</label>
				</Button>
			</span>
			<input id="whitelist-file-select" type="file"
				style={{display: "none"}}
				onChange={(e) => bulkWhitelist(e, control)}
			/>
			<span style={{padding: "20px"}}>
				<Button>
					<label htmlFor="banlist-file-select">
						Bulk Banlist Import
					</label>
				</Button>
			</span>
			<input id="banlist-file-select"type="file"
				style={{display: "none"}}
				onChange={ (e) => bulkBanned(e, control)}
			/>
		</div>
	</PageLayout>;
}
