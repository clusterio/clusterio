import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import * as lib from "@clusterio/lib";

import { useRoles } from "../model/roles";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "./useColumnSearch";

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
	let navigate = useNavigate();
	const [roles] = useRoles();
	const tableState = useTableQueryState<lib.Role>({ namespace: "role", pagination: false });
	const nameSearch = useColumnSearch<lib.Role>(role => role.name, "Search roles");

	return <PageLayout nav={[{ name: "Roles" }]}>
		<PageHeader
			title="Roles"
			extra={account.hasPermission("core.role.create") ? <CreateRoleButton /> : undefined}
		/>
		<Table
			columns={([
				{
					title: "Name",
					dataIndex: "name",
					sorter: (a, b) => strcmp(a.name, b.name),
					...nameSearch,
				},
				{
					title: "Description",
					dataIndex: "description",
				},
			] satisfies ColumnsType<lib.Role>).map(tableState.applyColumn)}
			dataSource={[...roles.values()]}
			pagination={tableState.pagination}
			rowKey={role => role.id}
			onChange={tableState.onChange}
			onRow={(role, rowIndex) => ({
				onClick: event => {
					navigate(`/roles/${role.id}/view`);
				},
			})}
		/>
		<PluginExtra component="RolesPage" />
	</PageLayout>;
}
