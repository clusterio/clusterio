import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Table } from "antd";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import useRowNavigation from "../util/useRowNavigation";
import Link from "./Link";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function CreateRoleButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	async function createRole() {
		let values = form.getFieldsValue();
		if (!values.roleName) {
			form.setFields([{ name: "roleName", errors: ["Name is required"] }]);
			return;
		}

		let idRole = await control.send(
			new lib.RoleCreateRequest(values.roleName, values.description || "", [])
		);
		setOpen(false);
		navigate(`/roles/${idRole}/view`);
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
			destroyOnHidden
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
	const [roles] = useRoles();
	const rowNav = useRowNavigation();

	return <PageLayout nav={[{ name: "Roles" }]}>
		<PageHeader
			title="Roles"
			extra={account.hasPermission("core.role.create") ? <CreateRoleButton /> : undefined}
		/>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					sorter: (a, b) => strcmp(a.name, b.name),
					className: "table-link-cell",
					render: (_, role) => <Link to={`/roles/${role.id}/view`} style={{ color: "inherit" }}>
						{role.name}
					</Link>,
				},
				{
					title: "Description",
					dataIndex: "description",
				},
			]}
			dataSource={[...roles.values()]}
			pagination={false}
			rowKey={role => role.id}
			onRow={role => rowNav(`/roles/${role.id}/view`)}
		/>
		<PluginExtra component="RolesPage" />
	</PageLayout>;
}
