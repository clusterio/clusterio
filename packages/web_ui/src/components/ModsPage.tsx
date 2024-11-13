import React, { Fragment, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Typography, Upload } from "antd";
import ImportOutlined from "@ant-design/icons/ImportOutlined";
import PlusOutlined from "@ant-design/icons/PlusOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useMods } from "../model/mods";
import { useModPacks } from "../model/mod_pack";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import SectionHeader from "./SectionHeader";
import ModDetails from "./ModDetails";
import { Dropzone } from "./Dropzone";
import UploadButton from "./UploadButton";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function ImportModPackButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	function close() {
		setOpen(false);
	}
	return <>
		<Button icon={<ImportOutlined />} onClick={() => { setOpen(true); }}>Import string</Button>
		<Modal
			title="Import Mod Pack String"
			open={open}
			okText="Import"
			cancelText="Cancel"
			onCancel={() => { setOpen(false); }}
			onOk={() => {
				(async () => {
					let values;
					try {
						values = await form.validateFields();
					} catch {
						return; // Validation failed
					}
					const modPack = lib.ModPack.fromModPackString(values.string);
					await control.send(new lib.ModPackCreateRequest(modPack));
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				})().catch(notifyErrorHandler("Error creating mod pack"));
			}}
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="string"
					rules={[
						{ required: true },
						{
							async validator(rule, value) {
								if (value) {
									lib.ModPack.fromModPackString(value);
								}
							},
						},
					]}
				>
					<Input.TextArea autoSize={{ minRows: 6, maxRows: 6 }} />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function CreateModPackButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	function close() {
		setOpen(false);
	}
	return <>
		<Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); }}>Create</Button>
		<Modal
			title="Create Mod Pack"
			open={open}
			okText="Create"
			cancelText="Cancel"
			onCancel={() => { setOpen(false); }}
			onOk={() => {
				(async () => {
					let values;
					try {
						values = await form.validateFields();
					} catch {
						return; // Validation failed
					}
					const modPack = lib.ModPack.fromJSON({
						name: values.name,
						description: values.description,
						factorio_version: values.factorioVersion,
					} as any);
					await control.send(new lib.ModPackCreateRequest(modPack));
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				})().catch(notifyErrorHandler("Error creating mod pack"));
			}}
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="name" label="Name" rules={[{ required: true }]}>
					<Input />
				</Form.Item>
				<Form.Item name="description" label="Description">
					<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
				</Form.Item>
				<Form.Item
					name="factorioVersion"
					label="Factorio Version"
					rules={[{
						required: true,
						pattern: /^\d+\.\d+(\.\d+)?$/,
						message: "Must be an a.b or a.b.c version number.",
					}]}
				>
					<Input />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function ModsPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [mods] = useMods();
	let [modPacks] = useModPacks();

	function actions(mod: lib.ModInfo) {
		return <Space>
			{account.hasPermission("core.mod.download")
				&& <Typography.Link
					onClick={() => {
						control.send(
							new lib.ModDownloadRequest(mod.name, mod.version)
						).then((streamId: string) => {
							let url = new URL(webRoot, document.location.origin);
							url.pathname += `api/stream/${streamId}`;
							document.location = url.href;
						}).catch(
							notifyErrorHandler("Error downloading save")
						);
					}}
				>download</Typography.Link>
			}
			{account.hasPermission("core.mod.delete")
				&& <Popconfirm
					title={`Delete ${mod.filename}?`}
					onConfirm={event => {
						control.send(
							new lib.ModDeleteRequest(mod.name, mod.version)
						).catch(notifyErrorHandler("Error deleting mod"));
					}}
					okText="Delete"
					okButtonProps={{ danger: true }}
				>
					<Typography.Link type="danger">delete</Typography.Link>
				</Popconfirm>
			}
		</Space>;
	}

	let uploadButton;
	if (account.hasPermission("core.mod.upload")) {
		uploadButton = <Upload
			name="file"
			accept=".zip"
			multiple
			showUploadList={false}
			headers={{
				"X-Access-Token": control.connector.token || "",
			}}
			action={`${webRoot}api/upload-mod`}
		>
			<UploadButton />
		</Upload>;
	}

	return <PageLayout nav={[{ name: "Mods" }]}>
		<PageHeader title="Mods" />
		<SectionHeader
			title="Mod Packs"
			extra={<Space>
				{account.hasPermission("core.mod_pack.create") && <ImportModPackButton />}
				{account.hasPermission("core.mod_pack.create") && <CreateModPackButton />}
			</Space>}
		/>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "Factorio Version",
					dataIndex: "factorioVersion",
					sorter: (a, b) => a.integerFactorioVersion - b.integerFactorioVersion,
				},
				{
					title: "Mods",
					key: "mods",
					render: (_, modPack) => modPack.mods.size,
				},
			]}
			dataSource={[...modPacks.values()]}
			pagination={false}
			rowKey={modPack => Number(modPack.id)}
			onRow={(modPack, rowIndex) => ({
				onClick: event => {
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				},
			})}
		/>
		<SectionHeader title="Stored Mods" extra={uploadButton} />

		<Upload.Dragger
			className="save-list-dragger"
			openFileDialogOnClick={false}
			name="file"
			accept=".zip"
			multiple
			headers={{
				"X-Access-Token": control.connector.token || "",
			}}
			action={`${webRoot}api/upload-mod`}
			showUploadList={false}
		>
			<Dropzone />
			<Table
				columns={[
					{
						title: "Name",
						dataIndex: "title",
						defaultSortOrder: "ascend",
						sorter: (a, b) => (
							strcmp(a.name, b.name) || a.integerVersion - b.integerVersion
						),
					},
					{
						title: "Version",
						key: "version",
						align: "right",
						render: (_, mod) => <>
							{`${mod.version} `}
							<Typography.Text type="secondary">{`/ ${mod.factorioVersion}`}</Typography.Text>
						</>,
					},
					{
						title: "Filename",
						dataIndex: "filename",
						responsive: ["xl"],
						sorter: (a, b) => strcmp(a.filename, b.filename),
					},
					{
						title: "Size",
						key: "size",
						responsive: ["lg"],
						render: (_, mod) => lib.formatBytes(mod.size),
						align: "right",
						sorter: (a, b) => a.size - b.size,
					},
					{
						title: "Action",
						key: "action",
						responsive: ["lg"],
						render: (_, mod) => actions(mod),
					},
				]}
				expandable={{
					expandedRowRender: (mod: lib.ModInfo) => <ModDetails mod={mod} actions={actions} />,
					expandedRowClassName: () => "no-expanded-padding",
				}}
				dataSource={[...mods.values()]}
				pagination={false}
				rowKey={mod => mod.id}
			/>
		</Upload.Dragger>
		<PluginExtra component="ModsPage" />
	</PageLayout>;
}
