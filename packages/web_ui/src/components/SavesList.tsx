import React, { useContext, useState } from "react";
import {
	message, Button, Checkbox, Form, Input, Modal,
	Popconfirm, Select, Space, Table, Tooltip, Upload,
} from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "../util/useColumnSearch";
import ControlContext from "./ControlContext";
import CreateSaveModal from "./CreateSaveModal";
import SectionHeader from "./SectionHeader";
import ResourceNotes from "./ResourceNotes";
import { useInstances } from "../model/instance";
import { useSavesOfInstance } from "../model/saves";
import { notifyErrorHandler } from "../util/notify";
import { Dropzone } from "./Dropzone";
import UploadButton from "./UploadButton";
import { useUploadProgress } from "./UploadProgress";


type ModalProps = {
	disabled: boolean;
	save: lib.SaveDetails;
	instanceId: number;
};

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


type TransferModalProps = {
	disabled: boolean;
	saves: lib.SaveDetails[];
	instanceId: number;
	buttonText?: string;
	onDone?: (failed: string[]) => void;
};

function TransferModal(props: TransferModalProps) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	let [instances] = useInstances();
	const single = props.saves.length === 1 ? props.saves[0] : undefined;
	const canCopy = account.hasPermission("core.instance.save.copy");

	async function transfer(values: { targetInstanceId: number, transferredName?: string, copy: boolean }) {
		const failed: string[] = [];
		for (const save of props.saves) {
			try {
				await control.send(new lib.InstanceTransferSaveRequest(
					props.instanceId,
					save.name,
					values.targetInstanceId,
					(single && values.transferredName) || save.name,
					values.copy,
				));
			} catch (err: any) {
				failed.push(save.name);
				notifyErrorHandler(`Error transfering ${save.name}`)(err);
			}
		}
		return failed;
	}

	return <>
		<Button disabled={props.disabled} onClick={() => setOpen(true)}>{props.buttonText ?? "Transfer"}</Button>
		<Modal
			title={single ? "Transfer save" : `Transfer ${props.saves.length} saves`}
			okText="Transfer"
			open={open}
			onOk={() => form.submit()}
			onCancel={() => setOpen(false)}
			destroyOnHidden
		>
			<Form
				form={form}
				labelCol={{ span: 6 }}
				wrapperCol={{ span: 18 }}
				initialValues={{ transferredName: single?.name, copy: !single && canCopy }}
				onFinish={values => {
					setOpen(false);
					let hide = message.loading(single ? "Transferring save..." : "Transferring saves...", 0);
					transfer(values).then(failed => {
						if (failed.length < props.saves.length) {
							message.success(failed.length ? "Transfer partially complete" : "Transfer complete");
						}
						form.resetFields();
						props.onDone?.(failed);
					}).finally(() => hide());
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
						optionFilterProp="title"
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
				{single && <Form.Item
					name="transferredName"
					label="Transferred name"
				>
					<Input
						disabled={!account.hasAnyPermission("core.instance.save.rename", "core.instance.save.copy")}
					/>
				</Form.Item>}
				<Form.Item
					name="copy"
					valuePropName="checked"
					label="Copy"
					tooltip="Copy instead of moving the save to the new instance."
				>
					<Checkbox disabled={!canCopy} />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}


export default function SavesList(props: { instance: lib.InstanceDetails }) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [saves] = useSavesOfInstance(props.instance.id);
	let [starting, setStarting] = useState(false);
	const { customRequest, list: uploadList } = useUploadProgress();
	const tableState = useTableQueryState<lib.SaveDetails>({
		namespace: "save", defaultSortKey: "mtimeMs", defaultSortOrder: "descend", pagination: { defaultPageSize: 10 },
	});
	const nameSearch = useColumnSearch<lib.SaveDetails>(tableState, "name", save => save.name, "Search saves");
	const [selectedNames, setSelectedNames] = useState<string[]>([]);

	const saveList = [...saves.values()];
	const selectedSaves = saveList.filter(save => selectedNames.includes(save.name));
	const nameFilter = tableState.filteredValue("name")?.[0]?.toLowerCase();
	const visibleNames = saveList
		.filter(save => !nameFilter || save.name.toLowerCase().includes(nameFilter))
		.map(save => save.name);
	const visibleSelected = visibleNames.filter(name => selectedNames.includes(name)).length;
	const canTransfer = account.hasPermission("core.instance.save.transfer");

	let hostOffline = ["unassigned", "unknown"].includes(props.instance.status!);
	const saveTable = <Table
		className="save-list-table"
		size="small"
		columns={[
			{
				title: "Name",
				key: "name",
				render: (_, save) => <>
					{save.name}
					{save.loaded && <Tooltip title="Currently loaded save"><CaretLeftOutlined /></Tooltip>}
					{save.loadByDefault && <Tooltip title="Save loaded by default"><LeftOutlined /></Tooltip>}
				</>,
				sorter: (a, b) => a.name.localeCompare(b.name),
				sortOrder: tableState.sortOrder("name"),
				filteredValue: tableState.filteredValue("name"),
				...nameSearch,
			},
			{
				title: "Size",
				key: "size",
				responsive: ["sm"],
				render: (_, save) => lib.formatBytes(save.size),
				align: "right",
				sorter: (a, b) => a.size - b.size,
				sortOrder: tableState.sortOrder("size"),
			},
			{
				title: "Last Modified",
				key: "mtimeMs",
				render: (_, save) => new Date(save.mtimeMs).toLocaleString(),
				sorter: (a, b) => a.mtimeMs - b.mtimeMs,
				sortOrder: tableState.sortOrder("mtimeMs"),
			},
		]}
		dataSource={saveList}
		pagination={tableState.pagination}
		onChange={tableState.onChange}
		rowKey={save => save.name}
		rowSelection={canTransfer ? {
			selectedRowKeys: selectedSaves.map(save => save.name),
			onChange: keys => setSelectedNames(keys as string[]),
			// Select all covers every save matching the search, not just the current page.
			columnTitle: <Checkbox
				disabled={!visibleNames.length}
				checked={visibleNames.length > 0 && visibleSelected === visibleNames.length}
				indeterminate={visibleSelected > 0 && visibleSelected < visibleNames.length}
				onChange={e => setSelectedNames(e.target.checked
					? [...new Set([...selectedNames, ...visibleNames])]
					: selectedNames.filter(name => !visibleNames.includes(name))
				)}
			/>,
		} : undefined}
		expandable={{
			columnWidth: 33,
			expandRowByClick: true,
			expandedRowRender: save => <Space direction="vertical" style={{ width: "100%" }}>
				<Space wrap>
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
					{canTransfer && <TransferModal
						disabled={hostOffline} instanceId={props.instance.id!} saves={[save]}
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
				</Space>
				<ResourceNotes resourceType="save" resourceId={save.id} compact />
			</Space>,
		}}
	/>;

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
		customRequest,
	};

	return <div>
		<SectionHeader title="Saves" extra={<Space wrap>
			{canTransfer && selectedSaves.length > 0 && <TransferModal
				disabled={hostOffline}
				instanceId={props.instance.id!}
				saves={selectedSaves}
				buttonText={`Transfer ${selectedSaves.length} selected`}
				onDone={failed => setSelectedNames(failed)}
			/>}
			{account.hasPermission("core.instance.save.upload") && <Upload {...uploadProps} >
				<UploadButton disabled={hostOffline}>
					Upload save
				</UploadButton>
			</Upload>}
			{account.hasPermission("core.instance.save.create") && <CreateSaveModal instance={props.instance} />}
		</Space>} />
		{uploadList}
		{
			account.hasPermission("core.instance.save.upload")
				? <Upload.Dragger className="save-list-dragger" openFileDialogOnClick={false} {...uploadProps}>
					<Dropzone disabled={hostOffline} />
					{saveTable}
				</Upload.Dragger>
				: saveTable
		}
	</div>;
}
