import React, { useContext, useState } from "react";
import {
	message, Button, Checkbox, Form, Input, List, Modal,
	Popconfirm, Progress, Select, Space, Table, Tooltip, Upload,
} from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import CreateSaveModal from "./CreateSaveModal";
import SectionHeader from "./SectionHeader";
import { useInstances } from "../model/instance";
import { useSavesOfInstance } from "../model/saves";
import { notifyErrorHandler } from "../util/notify";
import { InboxOutlined } from "@ant-design/icons";


type ModalProps = {
	disabled: boolean;
	save: lib.SaveDetails;
	instanceId: number;
}

function RenameModal(props: ModalProps) {
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	return <>
		<Button disabled={props.disabled} onClick={() => setOpen(true)}>Rename</Button>
		<Modal
			title="Rename save"
			okText="Rename"
			open={open}
			onOk={() => form.submit()}
			onCancel={() => setOpen(false)}
		>
			<Form
				form={form}
				layout="vertical"
				initialValues={{ newName: props.save.name }}
				onFinish={values => {
					control.send(
						new lib.InstanceRenameSaveRequest(props.instanceId, props.save.name, values.newName)
					).then(() => {
						setOpen(false);
						form.resetFields();
					}).catch(notifyErrorHandler("Error renaming save"));
				}}
			>
				<Form.Item
					name="newName"
					label="New name"
					rules={[{ required: true, message: "New name is required" }]}
				>
					<Input autoFocus />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function CopyModal(props: ModalProps) {
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	return <>
		<Button disabled={props.disabled} onClick={() => setOpen(true)}>Copy</Button>
		<Modal
			title="Copy save"
			okText="Copy"
			open={open}
			onOk={() => form.submit()}
			onCancel={() => setOpen(false)}
		>
			<Form
				form={form}
				layout="vertical"
				initialValues={{ newName: props.save.name }}
				onFinish={values => {
					control.send(
						new lib.InstanceCopySaveRequest(props.instanceId, props.save.name, values.newName)
					).then(() => {
						setOpen(false);
						form.resetFields();
					}).catch(notifyErrorHandler("Error copying save"));
				}}
			>
				<Form.Item
					name="newName"
					label="New name"
					rules={[{ required: true, message: "New name is required" }]}
				>
					<Input autoFocus />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}


function TransferModal(props: ModalProps) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	let [instances] = useInstances();

	return <>
		<Button disabled={props.disabled} onClick={() => setOpen(true)}>Transfer</Button>
		<Modal
			title="Transfer save"
			okText="Transfer"
			open={open}
			onOk={() => form.submit()}
			onCancel={() => setOpen(false)}
			destroyOnClose
		>
			<Form
				form={form}
				labelCol={{ span: 6 }}
				wrapperCol={{ span: 18 }}
				initialValues={{ transferredName: props.save.name, copy: false }}
				onFinish={values => {
					setOpen(false);
					let hide = message.loading("Transferring save...", 0);
					control.send(new lib.InstanceTransferSaveRequest(
						props.instanceId,
						props.save.name,
						values.targetInstanceId,
						values.transferredName || props.save.name,
						values.copy,
					)).then(() => {
						message.success("Transfer complete");
						form.resetFields();
					}).catch(
						notifyErrorHandler("Error transfering save")
					).finally(() => hide());
				}}
			>
				<Form.Item
					name="targetInstanceId"
					label="Target Instance"
					rules={[{ required: true, message: "Target Instance is required" }]}
				>
					<Select
						autoFocus
						showSearch
						filterOption={(input, option) => (
							(option?.title!.toLowerCase().indexOf(input.toLowerCase()) ?? -1) >= 0
						)}
					>
						{[...instances.values()].filter(
							instance => instance["id"] !== props.instanceId
						).map((instance) => <Select.Option
							key={instance.id}
							value={instance.id}
							title={instance.name}
							disabled={["unassigned", "unknown"].includes(instance.status)}
						>
							{instance.name}
							{instance.status === "unassigned" && " (unassigned)"}
							{instance.status === "unknown" && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>
				<Form.Item
					name="transferredName"
					label="Transferred name"
				>
					<Input
						disabled={!account.hasAnyPermission("core.instance.save.rename", "core.instance.save.copy")}
					/>
				</Form.Item>
				<Form.Item
					name="copy"
					valuePropName="checked"
					label="Copy"
					tooltip="Copy instead of moving the save to the new instance."
				>
					<Checkbox
						disabled={!account.hasPermission("core.instance.save.copy")}
					/>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}


type File = {
	uid: string;
	name: string;
	percent: number;
	status: string;
}

export default function SavesList(props: { instance: lib.InstanceDetails }) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [saves] = useSavesOfInstance(props.instance.id);
	let [starting, setStarting] = useState(false);
	let [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
	const [isDroppingFile, setIsDroppingFile] = useState<boolean>(false);

	let hostOffline = ["unassigned", "unknown"].includes(props.instance.status!);
	const saveTable = <Table
		className="save-list-table"
		size="small"
		columns={[
			{
				title: "Name",
				render: (_, save) => <>
					{save.name}
					{save.loaded && <Tooltip title="Currently loaded save"><CaretLeftOutlined /></Tooltip>}
					{save.loadByDefault && <Tooltip title="Save loaded by default"><LeftOutlined /></Tooltip>}
				</>,
				sorter: (a, b) => a.name.localeCompare(b.name),
			},
			{
				title: "Size",
				key: "size",
				responsive: ["sm"],
				render: (_, save) => lib.formatBytes(save.size),
				align: "right",
				sorter: (a, b) => a.size - b.size,
			},
			{
				title: "Last Modified",
				key: "mtimeMs",
				render: (_, save) => new Date(save.mtimeMs).toLocaleString(),
				sorter: (a, b) => a.mtimeMs - b.mtimeMs,
				defaultSortOrder: "descend",
			},
		]}
		dataSource={[...saves.values()]}
		rowKey={save => save.name}
		expandable={{
			columnWidth: 33,
			expandRowByClick: true,
			expandedRowRender: save => <Space wrap style={{ marginBottom: 0 }}>
				{account.hasPermission("core.instance.start") && <Button
					loading={starting}
					disabled={props.instance.status !== "stopped"}
					onClick={() => {
						setStarting(true);
						control.sendTo(
							{ instanceId: props.instance.id! },
							new lib.InstanceStartRequest(save.name),
						).catch(
							notifyErrorHandler("Error loading save")
						).finally(
							() => { setStarting(false); }
						);
					}}
				>Load save</Button>}
				{account.hasPermission("core.instance.save.rename") && <RenameModal
					disabled={hostOffline} instanceId={props.instance.id!} save={save}
				/>}
				{account.hasPermission("core.instance.save.copy") && <CopyModal
					disabled={hostOffline} instanceId={props.instance.id!} save={save}
				/>}
				{account.hasPermission("core.instance.save.download") && <Button
					disabled={hostOffline}
					onClick={() => {
						control.send(
							new lib.InstanceDownloadSaveRequest(props.instance.id!, save.name)
						).then(streamId => {
							let url = new URL(webRoot, document.location.href);
							url.pathname += `api/stream/${streamId}`;
							document.location.assign(url);
						}).catch(
							notifyErrorHandler("Error downloading save")
						);
					}}
				>Download</Button>}
				{account.hasPermission("core.instance.save.transfer") && <TransferModal
					disabled={hostOffline} instanceId={props.instance.id!} save={save}
				/>}
				{account.hasPermission("core.instance.save.delete") && <Popconfirm
					title="Permanently delete save?"
					okText="Delete"
					placement="top"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						control.send(
							new lib.InstanceDeleteSaveRequest(props.instance.id!, save.name)
						).catch(notifyErrorHandler("Error deleting save"));
					}}
				>
					<Button danger disabled={hostOffline}>Delete</Button>
				</Popconfirm>}
			</Space>,
		}}
	/>;

	function onChange(changeEvent: any) {
		if (["done", "error"].includes(changeEvent.file.status)) {
			if (changeEvent.file.status === "error") {
				notifyErrorHandler("Error uploading file")(changeEvent.file.error);
			}

			let newUploadingFiles = [...uploadingFiles];
			let index = newUploadingFiles.findIndex(f => f.uid === changeEvent.file.uid);
			if (index !== -1) {
				newUploadingFiles.splice(index, 1);
				setUploadingFiles(newUploadingFiles);
			}
			return;
		}

		let file: File = {
			uid: changeEvent.file.uid,
			name: changeEvent.file.name,
			percent: changeEvent.file.percent,
			status: changeEvent.file.status,
		};

		let newUploadingFiles = [...uploadingFiles];
		let index = newUploadingFiles.findIndex(f => f.uid === changeEvent.file.uid);
		if (index !== -1) {
			newUploadingFiles[index] = file;
		} else {
			newUploadingFiles.push(file);
		}
		setUploadingFiles(newUploadingFiles);
	}

	let uploadProps = {
		disabled: hostOffline,
		name: "file",
		accept: ".zip",
		headers: {
			"X-Access-Token": control.connector.token || "",
		},
		data: {
			instance_id: props.instance.id,
		},
		showUploadList: false,
		action: `${webRoot}api/upload-save`,
		onChange,
	};

	return <div>
		<SectionHeader title="Saves" extra={<Space>
			{account.hasPermission("core.instance.save.upload") && <Upload {...uploadProps} >
				<Button disabled={hostOffline}>Upload save</Button>
			</Upload>}
			{account.hasPermission("core.instance.save.create") && <CreateSaveModal instance={props.instance} />}
		</Space>} />
		{
			account.hasPermission("core.instance.save.upload")
				? <Upload.Dragger className="save-list-dragger" openFileDialogOnClick={false} {...uploadProps}>
					<div
						style={{
							position: "relative",
							zIndex: "1010",
						}}
						onDragEnter={e => {
							setIsDroppingFile(true);
						}}
						onDragLeave={e => {
							if ((e.currentTarget as Node).contains(e.relatedTarget as Node)) {
								return;
							}
							setIsDroppingFile(false);
						}}
						onDrop={e => setIsDroppingFile(false)}
					>
						<div
							style={{
								position: "absolute",
								top: "0",
								left: "0",
								width: "100%",
								height: "100%",
								zIndex: "90",
								backgroundColor: "#88888844",
								borderRadius: "20px",
								border: "dashed 2px rgb(22, 119, 255)",
								display: isDroppingFile ? "block" : "none",
							}}
						>
							<div
								id="dropzone-icon"
								style={{
									fontSize: "72px",
									color: "rgb(22, 119, 255)",
									display: "flex",
									zIndex: "100",
									alignItems: "center",
									justifyContent: "center",
									flexDirection: "column",
									height: "100%",
								}}
							>
								<InboxOutlined />
								<p style={{
									fontSize: "24px",
									display: "block",
									textAlign: "center",
									marginTop: "8px",
								}}>
									Drop to upload
								</p>
							</div>
						</div>
						{saveTable}
					</div>
				</Upload.Dragger>
				: saveTable
		}
		{uploadingFiles.length ? <List>
			{uploadingFiles.map(file => <List.Item key={file.uid}>
				{file.name}
				<Progress
					percent={file.percent}
					format={percent => `${Math.floor(percent || 0)}%`}
					status={file.status === "error" ? "exception" : "normal"}
				/>
			</List.Item>)}
		</List> : null}
	</div>;
}
