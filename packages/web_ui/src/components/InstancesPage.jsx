import React, { useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table } from "antd";

import { libConfig, libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { useInstanceList } from "../model/instance";
import { notifyErrorHandler } from "../util/notify";
import { useSlaveList } from "../model/slave";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function CreateInstanceButton(props) {
	let control = useContext(ControlContext);
	let history = useHistory();
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}

		let instanceConfig = new libConfig.InstanceConfig("control");
		await instanceConfig.init();
		instanceConfig.set("instance.name", values.instanceName);
		let serialized_config = instanceConfig.serialize("master");
		let result = await libLink.messages.createInstance.send(control, { serialized_config });
		setVisible(false);
		history.push(`/instances/${instanceConfig.get("instance.id")}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => {
				setVisible(true);
			}}
		>Create</Button>
		<Modal
			title="Create Instance"
			okText="Create"
			visible={visible}
			onOk={() => { createInstance().catch(notifyErrorHandler("Error creating instance")); }}
			onCancel={() => { setVisible(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="instanceName" label="Name">
					<Input/>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function InstancesPage() {
	let history = useHistory();
	let account = useAccount();
	let [slaveList] = useSlaveList();
	let [instanceList] = useInstanceList();

	function slaveName(slaveId) {
		let slave = slaveList.find(s => s.id === slaveId);
		if (slave) {
			return slave.name;
		}
		return String(slaveId);
	}

	return <PageLayout nav={[{ name: "Instances" }]}>
		<PageHeader
			className="site-page-header"
			title="Instances"
			extra={account.hasPermission("core.instance.create") && <CreateInstanceButton />}
		/>

		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a["name"], b["name"]),
				},
				{
					title: "Assigned Slave",
					key: "assigned_slave",
					render: instance => slaveName(instance["assigned_slave"]),
					sorter: (a, b) => strcmp(slaveName(a["assigned_slave"]), slaveName(b["assigned_slave"])),
				},
				{
					title: "Status",
					dataIndex: "status",
					sorter: (a, b) => strcmp(a["status"], b["status"]),
				},
			]}
			dataSource={instanceList}
			rowKey={instance => instance["id"]}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					history.push(`/instances/${record.id}/view`);
				},
			})}
		/>
	</PageLayout>;
}
