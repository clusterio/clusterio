import React, { useContext, useState } from "react";
import { Button, Form, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHostInvites } from "../model/host_invite";
import { notifyErrorHandler } from "../util/notify";
import { formatTimestamp } from "../util/time_format";
import ControlContext from "./ControlContext";
import CopyButton from "./CopyButton";
import Link from "./Link";
import SectionHeader from "./SectionHeader";

const expiryOptions = [
	{ label: "1 hour", value: 3600e3 },
	{ label: "24 hours", value: 86400e3 },
	{ label: "7 days", value: 7 * 86400e3 },
	{ label: "30 days", value: 30 * 86400e3 },
	{ label: "Never", value: 0 },
];

function inviteUrl(code: string) {
	return new URL(`${webRoot}invite/${code}`, document.location.origin).href;
}

function expiresAt(duration: number) {
	return duration ? Date.now() + duration : null;
}

function InviteStatusTag({ invite }: { invite: lib.HostInvite }) {
	if (invite.isExpired()) {
		return <Tag>Expired</Tag>;
	}
	if (invite.isUsedUp()) {
		return <Tag>Used up</Tag>;
	}
	return <Tag color="green">Active</Tag>;
}

function InviteInstructions({ url }: { url: string }) {
	const command = `npm init "@clusterio" -- --mode host --invite ${url} --host-name "Host"`;
	return <>
		<Typography.Paragraph>Invite URL:</Typography.Paragraph>
		<div className="codeblock">
			<CopyButton message="Copied invite URL to clipboard" text={url} />
			{url}
		</div>
		<Typography.Paragraph>
			A new host can be set up with the following commands:
		</Typography.Paragraph>
		<div className="codeblock">
			<CopyButton
				message="Copied host setup commands to clipboard"
				text={`mkdir clusterio\ncd clusterio\n${command}`}
			/>
			<p>&gt; mkdir clusterio</p>
			<p>&gt; cd clusterio</p>
			<p>&gt; {command}</p>
			<p>&gt; ./run-host</p>
		</div>
		<Typography.Paragraph>
			An existing host can join with <code>npx clusteriohost join {url}</code>
		</Typography.Paragraph>
	</>;
}

export function CreateHostInviteButton() {
	const control = useContext(ControlContext);
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const [form] = Form.useForm();

	async function createInvite() {
		const values = await form.validateFields();
		const response = await control.send(new lib.HostInviteCreateRequest(
			expiresAt(values.expires), values.maxUses ?? null,
		));
		setUrl(inviteUrl(response.invite.code));
	}

	return <>
		<Button onClick={() => { setOpen(true); }}>Create Invite</Button>
		<Modal
			title="Create Host Invite"
			open={open}
			okText="Create"
			footer={url !== null ? null : undefined}
			onOk={() => { createInvite().catch(notifyErrorHandler("Error creating invite")); }}
			onCancel={() => {
				setOpen(false);
				setUrl(null);
				form.resetFields();
			}}
			width="700px"
		>
			{url === null
				? <Form form={form} layout="vertical" initialValues={{ expires: 86400e3, maxUses: 1 }}>
					<Form.Item name="expires" label="Expires after">
						<Select options={expiryOptions} />
					</Form.Item>
					<Form.Item name="maxUses" label="Maximum uses" extra="Leave empty for unlimited uses">
						<InputNumber min={1} precision={0} placeholder="Unlimited" />
					</Form.Item>
				</Form>
				: <InviteInstructions url={url} />
			}
		</Modal>
	</>;
}

function EditHostInviteButton({ invite }: { invite: lib.HostInvite }) {
	const control = useContext(ControlContext);
	const [open, setOpen] = useState(false);
	const [form] = Form.useForm();

	async function updateInvite() {
		const values = await form.validateFields();
		await control.send(new lib.HostInviteUpdateRequest(
			invite.id,
			values.expires === "keep" ? undefined : expiresAt(values.expires),
			values.maxUses ?? null,
		));
		setOpen(false);
	}

	return <>
		<Button size="small" onClick={() => {
			form.setFieldsValue({ expires: "keep", maxUses: invite.maxUses });
			setOpen(true);
		}}>Edit</Button>
		<Modal
			title="Edit Host Invite"
			open={open}
			okText="Save"
			onOk={() => { updateInvite().catch(notifyErrorHandler("Error updating invite")); }}
			onCancel={() => { setOpen(false); }}
			forceRender
		>
			<Form form={form} layout="vertical">
				<Form.Item name="expires" label="Expires">
					<Select options={[
						{
							label: `Keep current (${
								invite.expiresAtMs ? formatTimestamp(invite.expiresAtMs) : "never"
							})`,
							value: "keep",
						},
						...expiryOptions.map(option => ({
							...option, label: option.value ? `${option.label} from now` : option.label,
						})),
					]} />
				</Form.Item>
				<Form.Item
					name="maxUses"
					label="Maximum uses"
					extra={`Used ${invite.uses} times, leave empty for unlimited uses`}
				>
					<InputNumber min={1} precision={0} placeholder="Unlimited" />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export function HostInvitesTable() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [invites] = useHostInvites();

	return <>
		<SectionHeader title="Invites" />
		<Table
			size="small"
			columns={[
				{
					title: "Code",
					key: "code",
					render: (_, invite) => <Space>
						<code>{lib.HostInvite.redactCode(invite.code)}</code>
						<CopyButton message="Copied invite URL to clipboard" text={inviteUrl(invite.code)} />
					</Space>,
				},
				{
					title: "Status",
					key: "status",
					render: (_, invite) => <InviteStatusTag invite={invite} />,
				},
				{
					title: "Uses",
					key: "uses",
					render: (_, invite) => `${invite.uses} / ${invite.maxUses ?? "unlimited"}`,
				},
				{
					title: "Expires",
					key: "expires",
					render: (_, invite) => (invite.expiresAtMs ? formatTimestamp(invite.expiresAtMs) : "Never"),
					sorter: (a, b) => (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity),
				},
				{
					title: "Created by",
					dataIndex: "createdBy",
				},
				{
					title: "Hosts",
					key: "hosts",
					render: (_, invite) => <Space wrap>
						{invite.hostIds.map(id => <Link key={id} to={`/hosts/${id}/view`}>{id}</Link>)}
					</Space>,
				},
				{
					key: "actions",
					align: "right",
					render: (_, invite) => <Space>
						{account.hasPermission("core.host.invite.update") && <EditHostInviteButton invite={invite} />}
						{account.hasPermission("core.host.invite.revoke") && <Popconfirm
							title="Revoke this invite? Hosts that already joined keep their tokens."
							placement="bottomRight"
							okText="Revoke"
							okButtonProps={{ danger: true }}
							onConfirm={() => {
								control.send(new lib.HostInviteRevokeRequest(invite.id))
									.catch(notifyErrorHandler("Error revoking invite"));
							}}
						>
							<Button size="small" danger>Revoke</Button>
						</Popconfirm>}
					</Space>,
				},
			]}
			dataSource={[...invites.values()].sort((a, b) => b.createdAtMs - a.createdAtMs)}
			rowKey={invite => invite.id}
			pagination={false}
		/>
	</>;
}
