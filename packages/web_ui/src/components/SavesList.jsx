import React, { useContext, useState } from "react";
import { Button, Form, Input, List, Modal, Popconfirm, Progress, Space, Table, Tooltip, Upload } from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import CreateSaveModal from "./CreateSaveModal";
import SectionHeader from "./SectionHeader";
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

function formatBytes(bytes) {
	if (bytes === 0) {
		return "0 Bytes";
	}

	let units = [" Bytes", " kB", " MB", " GB", " TB"];
	let factor = 1000;
	let power = Math.min(Math.floor(Math.log(bytes) / Math.log(factor)), units.length);
	return (power > 0 ? (bytes / factor ** power).toFixed(2) : bytes) + units[power];
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
				render: save => formatBytes(save.size),
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
