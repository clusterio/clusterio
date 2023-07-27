import React, { useContext, useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table } from "antd";

import { libData } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function CreateRoleButton() {
	let control = useContext(ControlContext);
	let history = useHistory();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	async function createRole() {
		let values = form.getFieldsValue();
		if (!values.roleName) {
			form.setFields([{ name: "roleName", errors: ["Name is required"] }]);
			return;
		}

		let result = await control.send(
			new libData.RoleCreateRequest(values.roleName, values.description || "", [])
		);
		setOpen(false);
		history.push(`/roles/${result.id}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => { setOpen(true); }}
		>Create</Button>
		<Modal
			title="Create Role"
			okText="Create"
			open={open}
			onOk={() => { createRole().catch(notifyErrorHandler("Error creating role")); }}
			onCancel={() => { setOpen(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="roleName" label="Name">
					<Input/>
				</Form.Item>
				<Form.Item name="description" label="Description">
					<Input/>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function RolesPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let history = useHistory();

	let [roles, setRoles] = useState([]);

	useEffect(() => {
		control.send(new libData.RoleListRequest()).then(newRoles => {
			setRoles(newRoles);
		}).catch(notifyErrorHandler("Error fetching role list"));
	}, []);

	return <PageLayout nav={[{ name: "Roles" }]}>
		<PageHeader
			className="site-page-header"
			title="Roles"
			extra={account.hasPermission("core.role.create") && <CreateRoleButton />}
		/>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "Description",
					dataIndex: "description",
				},
			]}
			dataSource={roles}
			pagination={false}
			rowKey={role => role.id}
			onRow={(role, rowIndex) => ({
				onClick: event => {
					history.push(`/roles/${role.id}/view`);
				},
			})}
		/>
		<PluginExtra component="RolesPage" />
	</PageLayout>;
}
