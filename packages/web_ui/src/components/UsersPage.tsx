import React, { useEffect, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, FormInstance, GetProp, Input, Modal, Radio, Space, Table, Tag, Upload, UploadProps } from "antd";
import { InboxOutlined } from "@ant-design/icons";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { formatDuration } from "../util/time_format";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { formatFirstSeen, formatLastSeen, sortFirstSeen, sortLastSeen, useUsers } from "../model/user";
import Link from "./Link";

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
					<Input />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

// This is the most common and best supported method
// For full support we should consider using npm:file-saver
function saveFile(name: string, blob: Blob) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.addEventListener("click", (e) => {
		setTimeout(() => URL.revokeObjectURL(a.href), 30 * 1000);
	});
	a.click();
};

function saveJson(name: string, json: object) {
	return saveFile(name, new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
}

type UserBulkActionProps = {
	setApplyAction(func: () => Promise<void>): void,
	form: FormInstance
}

function UserBulkActionImport({ setApplyAction, form }: UserBulkActionProps) {
	const control = useContext(ControlContext);
	const account = useAccount();

	const uploadProps: UploadProps = {
		accept: ".json",
		multiple: true,
		beforeUpload: (file) => false,
	};

	setApplyAction(async () => {
		const values = form.getFieldsValue();
		// console.log(values);
		for (const file of values.fileList as File[]) {
			// console.log(JSON.parse(await file.text()));
		}
	});

	const normaliseFiles = (e: any) => (Array.isArray(e) ? e : e.fileList).map((f: any) => f.originFileObj);

	return <>
		<Form.Item label="Type" name="importType" initialValue="mixed">
			<Radio.Group>
				<Radio.Button value="mixed" disabled={!account.hasAnyPermission(
					"core.user.set_admin", "core.user.set_banned", "core.user.set_whitelisted"
				)}>Mixed</Radio.Button>
				<Radio.Button value="users" disabled={!account.hasAllPermission(
					"core.user.set_admin", "core.user.set_banned", "core.user.set_whitelisted"
				)}>Users</Radio.Button>
				<Radio.Button value="admins" disabled={!account.hasPermission(
					"core.user.set_admin"
				)}>Admins</Radio.Button>
				<Radio.Button value="bans" disabled={!account.hasPermission(
					"core.user.set_banned"
				)}>Bans</Radio.Button>
				<Radio.Button value="whitelist" disabled={!account.hasPermission(
					"core.user.set_whitelisted"
				)}>Whitelist</Radio.Button>
			</Radio.Group>
		</Form.Item>
		<Form.Item name="fileList" valuePropName="fileList" getValueFromEvent={normaliseFiles} noStyle>
			<Upload.Dragger {...uploadProps}>
				<p className="ant-upload-drag-icon">
					<InboxOutlined />
				</p>
				<p className="ant-upload-text">Click or drag file to this area to import</p>
				<p className="ant-upload-hint">Support for a single or bulk import.</p>
			</Upload.Dragger>
		</Form.Item>
	</>;
}

function UserBulkActionExport({ setApplyAction, form }: UserBulkActionProps) {
	const control = useContext(ControlContext);

	setApplyAction(async () => {
		const values = form.getFieldsValue();
		// console.log(values);
		saveJson("test.json", values);
	});

	return <>
		<Form.Item label="Type" name="exportType" initialValue="users">
			<Radio.Group>
				<Radio.Button value="users">Users</Radio.Button>
				<Radio.Button value="admins">Admins</Radio.Button>
				<Radio.Button value="bans">Bans</Radio.Button>
				<Radio.Button value="whitelist">Whitelist</Radio.Button>
			</Radio.Group>
		</Form.Item>
	</>;
}

function BulkUserActionButton() {
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [formAction, setFormAction] = useState<string | undefined>(undefined);
	const [form] = Form.useForm();

	function onValuesChange({ action } : { action?: string }) {
		if (action) {
			setFormAction(action);
		}
	}

	let applyAction: () => Promise<void>;
	const setApplyAction = (func: () => Promise<void>) => { applyAction = func; };
	async function onOk() {
		if (!applyAction) {
			form.setFields([{ name: "action", errors: ["Action is required"] }]);
			return;
		}
		await applyAction();
		setFormAction(undefined);
		setOpen(false);
	}

	return <>
		<Button
			type="default"
			onClick={() => { setOpen(true); }}
		>Bulk Actions</Button>
		<Modal
			title="Bulk Actions"
			okText="Apply"
			open={open}
			okButtonProps={{disabled: formAction === undefined}}
			onOk={() => { onOk().catch(notifyErrorHandler(`Error running ${formAction}`)); }}
			onCancel={() => { setOpen(false); }}
			destroyOnClose
		>
			<Form form={form} onValuesChange={onValuesChange} clearOnDestroy>
				<Form.Item label="Action" name="action">
					<Radio.Group value={formAction}>
						{account.hasPermission("core.user.bulk_import")
							? <Radio.Button value="import">Import</Radio.Button> : undefined}
						{account.hasPermission("core.user.bulk_export")
							? <Radio.Button value="export">Export</Radio.Button> : undefined}
					</Radio.Group>
				</Form.Item>
				{formAction === "import" ? <UserBulkActionImport {...{setApplyAction, form}}/> : undefined}
				{formAction === "export" ? <UserBulkActionExport {...{setApplyAction, form}}/> : undefined}
			</Form>
		</Modal>
	</>;
}

export default function UsersPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [users] = useUsers();

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
			extra={<>
				{account.hasPermission("core.user.create") ? <CreateUserButton /> : undefined}
				{account.hasAnyPermission("core.user.bulk_import", "core.user.bulk_export")
					? <BulkUserActionButton /> : undefined}
			</>}
		/>
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					render: (_, user) => <Space>
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
					render: (_, user) => (
						[...user.roleIds]
							.map(id => <Link key={id} to={`/roles/${id}/view`} onClick={e => e.stopPropagation()}>
								<Tag>{(roles.get(id) || { name: id }).name}</Tag>
							</Link>)
					),
				},
				{
					title: "Online time",
					key: "onlineTime",
					render: (_, user) => (user.playerStats?.onlineTimeMs
						? formatDuration(user.playerStats.onlineTimeMs) : null),
					sorter: (a, b) => (a.playerStats?.onlineTimeMs ?? 0) -
						(b.playerStats?.onlineTimeMs ?? 0),
					responsive: ["lg"],
				},
				{
					title: "First seen",
					key: "firstSeen",
					render: (_, user) => formatFirstSeen(user),
					sorter: (a, b) => sortFirstSeen(a, b),
				},
				{
					title: "Last seen",
					key: "lastSeen",
					render: (_, user) => formatLastSeen(user),
					sorter: (a, b) => sortLastSeen(a, b),
					responsive: ["lg"],
				},
			]}
			dataSource={[...users.values()]}
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
