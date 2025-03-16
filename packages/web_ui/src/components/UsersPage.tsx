import React, { useEffect, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, FormInstance, GetProp, Input, Modal, Radio, Space, Table, Tag, Upload, UploadProps } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { Static } from "@sinclair/typebox";

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
	form: FormInstance,
	restore?: boolean,
}

function UserBulkActionImport({ setApplyAction, form, restore }: UserBulkActionProps) {
	const control = useContext(ControlContext);
	const account = useAccount();

	// Combines an array of users into the main array to be sent to the controller
	function combineMixed(
		prop: "is_admin" | "is_banned" | "is_whitelisted",
		users: Array<Static<typeof lib.ClusterioUserExport.factorioUserSchema>>,
		usersToSend: Map<string, Static<typeof lib.ClusterioUserExport.clusterioUserSchema>>
	) {
		for (const user of users) {
			if (typeof user !== "string") {
				// It can only be a ban in this case
				const existingUser = usersToSend.get(user.username);
				if (existingUser) {
					existingUser.is_banned = true;
					existingUser.ban_reason = existingUser.ban_reason ? existingUser.ban_reason : user.reason;
				} else {
					usersToSend.set(user.username, {
						is_banned: true,
						...user,
					});
				}
			} else {
				// We only have the username
				const existingUser = usersToSend.get(user);
				if (existingUser) {
					existingUser[prop] = true;
				} else {
					usersToSend.set(user, {
						username: user,
						[prop]: true,
					});
				}
			}
		}
	}

	// Parse a user json and combine into the format to be sent to the controller
	function parseUsers(
		users: Array<Static<typeof lib.ClusterioUserExport.clusterioUserSchema>>,
		usersToSend: Map<string, Static<typeof lib.ClusterioUserExport.clusterioUserSchema>>
	) {
		for (const user of users) {
			const existingUser = usersToSend.get(user.username);
			// Combine all fields with an existing user
			if (existingUser) {
				existingUser.is_admin ||= user.is_admin;
				existingUser.is_banned ||= user.is_banned;
				existingUser.is_whitelisted ||= user.is_whitelisted;
				existingUser.ban_reason = existingUser.ban_reason ? existingUser.ban_reason : user.ban_reason;
			}
			// We do not send false values
			if (user.is_admin === false) {
				delete user.is_admin;
			}
			if (user.is_banned === false) {
				delete user.is_banned;
				delete user.ban_reason;
			}
			if (user.is_whitelisted === false) {
				delete user.is_whitelisted;
			}
			usersToSend.set(user.username, user);
		}
	}

	// Parse a ban json and combine into the format to be sent to the controller
	function parseBans(
		users: Array<Static<typeof lib.ClusterioUserExport.factorioUserSchema>>,
		usersToSend: Map<string, string | { username: string, reason: string }>
	) {
		for (const user of users) {
			if (typeof user === "string") {
				if (!usersToSend.has(user)) {
					usersToSend.set(user, user);
				}
			} else if (!user.reason) {
				if (!usersToSend.has(user.username)) {
					usersToSend.set(user.username, user.username);
				}
			} else {
				usersToSend.set(user.username, user);
			}
		}
	}

	// Parse an admin or whitelist json and combine into the format to be sent to the controller
	function parseAdminsWhitelist(
		users: Array<string>,
		usersToSend: Set<string>,
	) {
		for (const user of users) {
			usersToSend.add(user);
		}
	}

	setApplyAction(async () => {
		let backup: object | undefined;
		const values = form.getFieldsValue();
		const importType = restore ? values.restoreType : values.importType;
		switch (importType) {
			case "mixed": {
				// Parse and combine multiple json types then send
				const usersToSend = new Map<string, Static<typeof lib.ClusterioUserExport.clusterioUserSchema>>();
				for (const file of values.fileList as File[]) {
					const json = JSON.parse(await file.text());
					if (json.export_version) {
						parseUsers(json.users, usersToSend);
					} else if (file.name.includes("ban")) {
						const users = new Map();
						parseBans(json, users);
						combineMixed("is_banned", [...users.values()], usersToSend);
					} else if (file.name.includes("admin")) {
						const users = new Set<string>();
						parseAdminsWhitelist(json, users);
						combineMixed("is_admin", [...users.values()], usersToSend);
					} else if (file.name.includes("whitelist")) {
						const users = new Set<string>();
						parseAdminsWhitelist(json, users);
						combineMixed("is_whitelisted", [...users.values()], usersToSend);
					} else {
						throw new Error(`Unknown json (could not guess by file name): ${file.name}`);
					}
				}
				backup = await control.send(new lib.UserBulkImportRequest("users", [...usersToSend.values()], restore));
				break;
			}

			case "users": {
				// Parse and user jsons then send
				const usersToSend = new Map<string, Static<typeof lib.ClusterioUserExport.clusterioUserSchema>>();
				for (const file of values.fileList as File[]) {
					parseUsers(JSON.parse(await file.text()).users, usersToSend);
				}
				backup = await control.send(new lib.UserBulkImportRequest("users", [...usersToSend.values()], restore));
				break;
			}

			case "bans": {
				// Parse and combine ban jsons then send
				const usersToSend = new Map<string, Static<typeof lib.ClusterioUserExport.factorioUserSchema>>();
				for (const file of values.fileList as File[]) {
					parseBans(JSON.parse(await file.text()), usersToSend);
				}
				backup = await control.send(new lib.UserBulkImportRequest("bans", [...usersToSend.values()], restore));
				break;
			}

			case "admins":
			case "whitelist": {
				// Parse and combine admin or whitelist jsons then send
				const usersToSend = new Set<string>();
				for (const file of values.fileList as File[]) {
					parseAdminsWhitelist(JSON.parse(await file.text()), usersToSend);
				}
				backup = await control.send(
					new lib.UserBulkImportRequest(importType, [...usersToSend.keys()], restore)
				);
				break;
			}

			default: {
				// Should be unreachable
				throw new Error(`Unknown importType: ${importType}`);
			}
		}
		if (backup) {
			saveJson(`${importType}-backup.json`, backup);
		}
	});

	const normaliseFiles = (e: any) => (Array.isArray(e) ? e : e.fileList).map((f: any) => f.originFileObj);
	const uploadProps: UploadProps = {
		accept: ".json",
		multiple: true,
		beforeUpload: (file) => false,
	};

	return <>
		<Form.Item
			label="Type"
			name={restore ? "restoreType" : "importType"}
			initialValue={restore ? "users" : "mixed"}
		>
			<Radio.Group>
				{restore ? undefined : <Radio.Button value="mixed" disabled={!account.hasAnyPermission(
					"core.user.set_admin", "core.user.set_banned", "core.user.set_whitelisted"
				)}>Mixed</Radio.Button>}
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
		const response = await control.send(new lib.UserBulkExportRequest(values.exportType));
		switch (values.exportType) {
			case "users": return saveJson("clusterio-userlist.json", response);
			case "admins": return saveJson("server-adminlist.json", response);
			case "bans": return saveJson("server-banlist.json", response);
			case "whitelist": return saveJson("server-whitelist.json", response);
			default: throw new Error(`Unknown exportType: ${values.importType}`);
		}
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
						{account.hasPermission("core.user.bulk_restore")
							? <Radio.Button value="restore">Restore</Radio.Button> : undefined}
					</Radio.Group>
				</Form.Item>
				{formAction === "import" ? <UserBulkActionImport {...{setApplyAction, form}}/> : undefined}
				{formAction === "export" ? <UserBulkActionExport {...{setApplyAction, form}}/> : undefined}
				{formAction === "restore" ? <UserBulkActionImport restore {...{setApplyAction, form}}/> : undefined}
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
