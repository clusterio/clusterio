import React, { useEffect, useContext, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Checkbox, Input, Popconfirm, Space, Spin, Tooltip } from "antd";
import { ExclamationCircleOutlined, StarOutlined, DeleteOutlined} from "@ant-design/icons";

import * as lib from "@clusterio/lib";

import { useRole } from "../model/roles";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { notifyErrorHandler } from "../util/notify";


/** Splits a permission name into parts, removing the last part */
function getGroupName(name: string) {
	const parts = name.split(".");
	return parts.length <= 2
		? parts.slice(0, 2).join(".")
		: parts.slice(0, parts.length - 1).join(".");
}

/** Converts a group name into Title Case with _ and . removed */
function formatGroupTitle(name: string) {
	return name
		.replace(/\./g, " / ")
		.replace(/_/g, " ")
		.split(" ")
		.filter(Boolean)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

/** Check if a permission is dangerous, in the future we might have metadata for this */
function isDangerous(permission: lib.Permission) {
	return ["delete", "kill", "stop", "revoke", "update", "core.admin"]
		.some(word => permission.name.includes(word));
}

/** A single permission item inside a group; includes a checkbox, name, and description */
function PermissionItem({
	permission, baseline, checked, disabled, onChange,
}: {
	permission: lib.Permission;
	checked: boolean;
	baseline: boolean;
	disabled: boolean;
	onChange: (value: boolean) => void;
}) {
	const modified = checked !== baseline;

	return (
		<div style={{
			marginBottom: 8,
			padding: modified ? "4px 6px" : undefined,
			background: modified ? "#2a1912" : undefined,
			borderRadius: 4,
		}}>
			<div style={{ display: "flex", alignItems: "center" }}>
				<Checkbox checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}>
					<Space size={6}>
						<span>{permission.title}</span>

						{permission.grantByDefault && (
							<Tooltip title="Granted by default">
								<StarOutlined style={{ color: "#faad14" }} />
							</Tooltip>
						)}

						{isDangerous(permission) && (
							<Tooltip title="Dangerous permission">
								<ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />
							</Tooltip>
						)}
					</Space>
				</Checkbox>
			</div>

			<div style={{ marginLeft: 24, color: "#888", fontSize: 12 }}>
				{permission.description}
			</div>
		</div>
	);
}

/** A group of permissions; includes a title, clear and select all buttons, and the permission items */
function PermissionGroup({
	groupName, permissions, canUpdate, baselineState, permissionState, setPermissionState,
}: {
	groupName: string;
	permissions: lib.Permission[];
	canUpdate: boolean;

	baselineState: Record<string, boolean>;
	permissionState: Record<string, boolean>;
	setPermissionState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
	setEdited?: (value: boolean) => void;
}) {
	function setGroup(value: boolean) {
		setPermissionState((prev: any) => {
			const next = { ...prev };
			for (let p of permissions) {
				next[p.name] = value;
			}
			return next;
		});
	}

	return (
		<div style={{ border: "1px solid #424242", padding: 12, borderRadius: 6 }}>
			<Space style={{ width: "100%", justifyContent: "space-between" }}>
				<strong>{formatGroupTitle(groupName)}</strong>
				<Space>
					<Button size="small" onClick={() => setGroup(true)}>Select all</Button>
					<Button size="small" onClick={() => setGroup(false)}>Clear</Button>
				</Space>
			</Space>

			<div style={{ marginTop: 8 }}>
				{permissions.map((p: any) => (
					<PermissionItem
						key={p.name}
						permission={p}
						checked={permissionState[p.name]}
						baseline={baselineState[p.name]}
						disabled={!canUpdate}
						onChange={v => setPermissionState((prev: any) => ({ ...prev, [p.name]: v }))}
					/>
				))}
			</div>
		</div>
	);
}

/** The role page view */
export default function RoleViewPage() {
	const params = useParams();
	const roleId = Number(params.id);

	const navigate = useNavigate();
	const account = useAccount();
	const control = useContext(ControlContext);
	const [role, synced] = useRole(roleId);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [permissionState, setPermissionState] = useState<Record<string, boolean>>({});
	const [baselineState, setBaselineState] = useState<Record<string, boolean>>({});
	const [search, setSearch] = useState("");

	const allPermissions = useMemo(() => [...lib.permissions.values()], []);
	const canUpdate = Boolean(account.hasPermission("core.role.update"));

	useEffect(() => {
		if (!role) {
			return;
		}

		const base = Object.fromEntries(
			allPermissions.map(p => [p.name, role.permissions.has(p.name)])
		);

		setName(role.name);
		setDescription(role.description);
		setPermissionState(base);
		setBaselineState(base);
	}, [role, allPermissions]);

	// If no role then display either the loading screen or the not found screen
	if (!role) {
		const nav = [{ name: "Roles", path: "/roles" }, { name: String(roleId) }];

		if (!synced) {
			return <PageLayout nav={nav}>
				<PageHeader title={String(roleId)} />
				<Spin size="large" />
			</PageLayout>;
		}

		return <PageLayout nav={nav}>
			<PageHeader title="Role not found" />
			<p>Role with id {roleId} was not found on the controller.</p>
		</PageLayout>;
	}

	// Apply the filter by searching all permission fields
	const filtered = allPermissions.filter(p => {
		const q = search.toLowerCase();
		return p.name.toLowerCase().includes(q)
			|| p.title.toLowerCase().includes(q)
			|| p.description.toLowerCase().includes(q);
	});

	// Organise the permissions into groups
	const groups = new Map<string, typeof filtered>();
	for (let p of filtered) {
		const g = getGroupName(p.name);
		if (!groups.has(g)) {
			groups.set(g, []);
		}
		groups.get(g)!.push(p);
	}

	// Sort permissions alphabetically within their groups
	const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	for (let [, permissions] of sortedGroups) {
		permissions.sort((a, b) => a.title.localeCompare(b.title));
	}

	// Check if any changes have been made to the permissions or role metadata
	const permissionChanged = Object.keys(permissionState).some(k => permissionState[k] !== baselineState[k]);
	const metaChanged = name !== role.name || description !== role.description;
	const edited = permissionChanged || metaChanged;

	/** Applies all pending changes */
	function applyChanges() {
		const newPermissions = Object.entries(permissionState).filter(([, v]) => v).map(([k]) => k);
		control.send(new lib.RoleUpdateRequest(roleId, name || "", description || "", newPermissions))
			.then(() => {
				setBaselineState(permissionState);
			})
			.catch(notifyErrorHandler("Error applying changes"));
	}

	/** Revert any pending changes */
	function revertChanges() {
		setPermissionState(baselineState);
		if (role) {
			setName(role.name);
			setDescription(role.description);
		}
	}

	return (
		<PageLayout nav={[{ name: "Roles", path: "/roles" }, { name: role.name }]}>
			<PageHeader
				title={role.name}
				extra={<Space wrap>
					{account.hasPermission("core.role.delete") && <Popconfirm
						title="Delete role?"
						placement="bottomRight"
						okText="Delete"
						okButtonProps={{ danger: true }}
						onConfirm={() => {
							control.send(new lib.RoleDeleteRequest(roleId))
								.then(() => navigate("/roles"))
								.catch(notifyErrorHandler("Error deleting role"));
						}}
					>
						<Button danger><DeleteOutlined /></Button>
					</Popconfirm>}
				</Space>}
			/>

			{edited && (
				<div style={{
					position: "fixed",
					bottom: 24,
					left: "50%",
					transform: "translateX(-50%)",
					background: "#2a1912",
					borderRadius: 8,
					boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
					padding: "10px 14px",
					display: "flex",
					alignItems: "center",
					gap: 12,
					zIndex: 1000,
				}}>
					<span style={{ color: "#FFF" }}>
						You have unsaved changes
					</span>

					<Space>
						<Button onClick={revertChanges}>
							Revert
						</Button>

						<Button type="primary" onClick={applyChanges}>
							Apply
						</Button>
					</Space>
				</div>
			)}

			<div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
				<label style={{ width: 110, flexShrink: 0 }}>Name</label>
				<Input value={name} disabled={!canUpdate} onChange={e => setName(e.target.value)} />
			</div>

			<div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
				<label style={{ width: 110, flexShrink: 0 }}>Description</label>
				<Input value={description} disabled={!canUpdate} onChange={e => setDescription(e.target.value)} />
			</div>

			<h3>Permissions</h3>

			<Input.Search placeholder="Search permissions" allowClear
				onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />

			<Space direction="vertical" style={{ width: "100%" }}>
				{sortedGroups.map(([groupName, permissions]) => (
					<PermissionGroup
						key={groupName}
						groupName={groupName}
						permissions={permissions}
						permissionState={permissionState}
						baselineState={baselineState}
						setPermissionState={setPermissionState}
						canUpdate={canUpdate}
					/>
				))}
			</Space>

			<PluginExtra component="RoleViewPage" role={role} search={search}/>
		</PageLayout>
	);
}
