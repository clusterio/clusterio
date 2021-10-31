import React, { useContext, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table } from "antd";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { useSlaveList } from "../model/slave";
import { notifyErrorHandler } from "../util/notify";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function GenerateSlaveTokenButton(props) {
	let control = useContext(ControlContext);
	let [visible, setVisible] = useState(false);
	let [token, setToken] = useState(null);
	let [form] = Form.useForm();
	let tokenTextAreaRef = useRef(null);

	async function generateToken() {
		let values = form.getFieldsValue();
		let slaveId = null;
		if (values.slaveId) {
			slaveId = Number.parseInt(values.slaveId, 10);
			if (Number.isNaN(slaveId)) {
				form.setFields([{ name: "slaveId", errors: ["Must be an integer"] }]);
				return;
			}
			form.setFields([{ name: "slaveId", errors: [] }]);
		}

		let result = await libLink.messages.generateSlaveToken.send(control, { slave_id: slaveId });
		setToken(result.token);
	}

	return <>
		<Button
			onClick={() => { setVisible(true); }}
		>Generate Token</Button>
		<Modal
			title="Generate Slave Token"
			visible={visible}
			footer={null}
			onCancel={() => {
				setVisible(false);
				setToken(null);
				form.resetFields();
			}}
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="slaveId" label="Slave ID">
					<Input/>
				</Form.Item>
				<Form.Item>
					<Button
						onClick={() => { generateToken().catch(notifyErrorHandler("Error generating token")); }}
					>Generate</Button>
				</Form.Item>
				<Form.Item label="Token" required>
					<Input.TextArea value={token} autoSize ref={tokenTextAreaRef} />
				</Form.Item>
				<Button disabled={token === null} onClick={() => {
					let textArea = tokenTextAreaRef.current.resizableTextArea.textArea;
					textArea.select();
					document.execCommand("copy");
					window.getSelection().removeAllRanges();
				}}>Copy</Button>
			</Form>
		</Modal>
	</>;
}


export default function SlavesPage() {
	let account = useAccount();
	let history = useHistory();
	let [slaveList] = useSlaveList();

	return <PageLayout nav={[{ name: "Slaves" }]}>
		<PageHeader
			className="site-page-header"
			title="Slaves"
			extra={account.hasPermission("core.slave.generate_token") && <GenerateSlaveTokenButton />}
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
					title: "Agent",
					dataIndex: "agent",
					sorter: (a, b) => strcmp(a["agent"], b["agent"]),
					responsive: ["lg"],
				},
				{
					title: "Version",
					dataIndex: "version",
					sorter: (a, b) => strcmp(a["version"], b["version"]),
				},
				{
					title: "Connected",
					key: "connected",
					render: slave => slave["connected"] && "Yes",
					sorter: (a, b) => a["connected"] - b["connected"],
				},
			]}
			dataSource={slaveList}
			rowKey={slave => slave["id"]}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					history.push(`/slaves/${record.id}/view`);
				},
			})}
		/>
	</PageLayout>;
};
