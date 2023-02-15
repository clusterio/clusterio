import React, { useContext, useState } from "react";
import {
	message, Button, Checkbox, Form, Input, List, Modal,
	Popconfirm, Progress, Select, Space, Table, Tooltip, Upload,
} from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import { libLink, libHelpers } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import CreateSaveModal from "./CreateSaveModal";
import SectionHeader from "./SectionHeader";
import { useInstanceList } from "../model/instance";
import { useSaves } from "../model/saves";
import { notifyErrorHandler } from "../util/notify";


function RenameModal(props) {
	let control = useContext(ControlContext);
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	return <>
		<Button disabled={props.disabled} onClick={() => setVisible(true)}>Rename</Button>
		<Modal
			title="Rename save"
			okText="Rename"
			visible={visible}
			onOk={() => form.submit()}
			onCancel={() => setVisible(false)}
		>
			<Form
				form={form}
				layout="vertical"
				initialValues={{ newName: props.save.name }}
				onFinish={values => {
					libLink.messages.renameSave.send(control,
						{ instance_id: props.instanceId, old_name: props.save.name, new_name: values.newName }
					).then(() => {
						setVisible(false);
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

function CopyModal(props) {
	let control = useContext(ControlContext);
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	return <>
		<Button disabled={props.disabled} onClick={() => setVisible(true)}>Copy</Button>
		<Modal
			title="Copy save"
			okText="Copy"
			visible={visible}
			onOk={() => form.submit()}
			onCancel={() => setVisible(false)}
		>
			<Form
				form={form}
				layout="vertical"
				initialValues={{ newName: props.save.name }}
				onFinish={values => {
					libLink.messages.copySave.send(control,
						{ instance_id: props.instanceId, source: props.save.name, destination: values.newName }
					).then(() => {
						setVisible(false);
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

function TransferModal(props) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();
	let [instanceList] = useInstanceList();

	return <>
		<Button disabled={props.disabled} onClick={() => setVisible(true)}>Transfer</Button>
		<Modal
			title="Transfer save"
			okText="Transfer"
			visible={visible}
			onOk={() => form.submit()}
			onCancel={() => setVisible(false)}
			destroyOnClose
		>
			<Form
				form={form}
				labelCol={{ span: 6 }}
				wrapperCol={{ span: 18 }}
				initialValues={{ transferredName: props.save.name, copy: false }}
				onFinish={values => {
					setVisible(false);
					let hide = message.loading("Transferring save...", 0);
					libLink.messages.transferSave.send(control, {
						instance_id: props.instanceId,
						source_save: props.save.name,
						target_instance_id: values.targetInstanceId,
						target_save: values.transferredName || props.save.name,
						copy: values.copy,
					}).then(() => {
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
						filterOption={(input, option) => option.title.toLowerCase().indexOf(input.toLowerCase()) >= 0}
					>
						{instanceList.filter(
							instance => instance["id"] !== props.instanceId
						).map((instance) => <Select.Option
							key={instance["id"]}
							value={instance["id"]}
							title={instance["name"]}
							disabled={["unassigned", "unknown"].includes(instance["status"])}
						>
							{instance["name"]}
							{instance["status"] === "unassigned" && " (unassigned)"}
							{instance["status"] === "unknown" && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>
				<Form.Item
					name="transferredName"
					label="Transferred name"
					disabled={!account.hasAnyPermission("core.instance.save.rename", "core.instance.save.copy")}
				>
					<Input />
				</Form.Item>
				<Form.Item
					name="copy"
					valuePropName="checked"
					label="Copy"
					tooltip="Copy instead of moving the save to the new instance."
					disabled={!account.hasPermission("core.instance.save.copy")}
				>
					<Checkbox />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function SavesList(props) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let saves = useSaves(props.instance.id);
	let [starting, setStarting] = useState(false);
	let [uploadingFiles, setUploadingFiles] = useState([]);

	let slaveOffline = ["unassigned", "unknown"].includes(props.instance.status);
	const saveTable = <Table
		size="small"
		columns={[
			{
				title: "Name",
				render: save => <>
					{save.name}
					{save.loaded && <Tooltip title="Currently loaded save"><CaretLeftOutlined/></Tooltip>}
					{save.default && <Tooltip title="Save loaded by default"><LeftOutlined/></Tooltip>}
				</>,
				sorter: (a, b) => a.name.localeCompare(b.name),
			},
			{
				title: "Size",
				key: "size",
				responsive: ["sm"],
				render: save => libHelpers.formatBytes(save.size),
				align: "right",
				sorter: (a, b) => a.size - b.size,
			},
			{
				title: "Last Modified",
				key: "mtime_ms",
				render: save => new Date(save.mtime_ms).toLocaleString(),
				sorter: (a, b) => a.mtime_ms - b.mtime_ms,
				defaultSortOrder: "descend",
			},
		]}
		dataSource={saves}
		rowKey={save => save.name}
		pagination={false}
		expandable={{
			columnWidth: 33,
			expandRowByClick: true,
			expandedRowRender: save => <Space wrap style={{marginBottom: 0}}>
				{account.hasPermission("core.instance.start") && <Button
					loading={starting}
					disabled={props.instance.status !== "stopped"}
					onClick={() => {
						setStarting(true);
						libLink.messages.startInstance.send(
							control, { instance_id: props.instance.id, save: save.name }
						).catch(
							notifyErrorHandler("Error loading save")
						).finally(
							() => { setStarting(false); }
						);
					}}
				>Load save</Button>}
				{account.hasPermission("core.instance.save.rename") && <RenameModal
					disabled={slaveOffline} instanceId={props.instance.id} save={save}
				/>}
				{account.hasPermission("core.instance.save.copy") && <CopyModal
					disabled={slaveOffline} instanceId={props.instance.id} save={save}
				/>}
				{account.hasPermission("core.instance.save.download") && <Button
					disabled={slaveOffline}
					onClick={() => {
						libLink.messages.downloadSave.send(
							control, { instance_id: props.instance.id, save: save.name }
						).then(response => {
							let url = new URL(webRoot, document.location);
							url.pathname += `api/stream/${response.stream_id}`;
							document.location = url;
						}).catch(
							notifyErrorHandler("Error downloading save")
						);
					}}
				>Download</Button>}
				{account.hasPermission("core.instance.save.transfer") && <TransferModal
					disabled={slaveOffline} instanceId={props.instance.id} save={save}
				/>}
				{account.hasPermission("core.instance.save.delete") && <Popconfirm
					title="Permanently delete save?"
					okText="Delete"
					placement="top"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						libLink.messages.deleteSave.send(
							control, { instance_id: props.instance.id, save: save.name }
						).catch(notifyErrorHandler("Error deleting save"));
					}}
				>
					<Button danger disabled={slaveOffline}>Delete</Button>
				</Popconfirm>}
			</Space>,
		}}
	/>;

	function onChange(changeEvent) {
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

		let file = {
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
		disabled: slaveOffline,
		name: "file",
		accept: ".zip",
		headers: {
			"X-Access-Token": control.connector.token,
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
				<Button disabled={slaveOffline}>Upload save</Button>
			</Upload>}
			{account.hasPermission("core.instance.save.create") && <CreateSaveModal instance={props.instance} />}
		</Space>} />
		{
			account.hasPermission("core.instance.save.upload")
				? <Upload.Dragger className="save-list-dragger" openFileDialogOnClick={false} {...uploadProps}>
					{saveTable}
				</Upload.Dragger>
				: saveTable
		}
		{uploadingFiles.length ? <List>
			{uploadingFiles.map(file => <List.Item key={file.uid}>
				{file.name}
				<Progress
					percent={file.percent}
					format={percent => `${Math.floor(percent)}%`}
					status={file.status === "error" ? "exception" : "normal"}
				/>
			</List.Item>)}
		</List> : null}
	</div>;
}
