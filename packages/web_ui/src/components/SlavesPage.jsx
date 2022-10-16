import React, { useContext, useRef, useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader, Table, Tag, Typography } from "antd";
import CopyOutlined from "@ant-design/icons/lib/icons/CopyOutlined";

import { libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useSlaveList } from "../model/slave";
import notify, { notifyErrorHandler } from "../util/notify";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function GenerateSlaveTokenButton(props) {
	let control = useContext(ControlContext);
	let [visible, setVisible] = useState(false);
	let [token, setToken] = useState(null);
	let [slaveId, setSlaveId] = useState(null);
	let [form] = Form.useForm();
	let tokenTextAreaRef = useRef(null);
	let [pluginList, setPluginList] = useState([]);
	useEffect(() => {
		(async () => {
			let response = await fetch(`${webRoot}api/plugins`);
			if (response.ok) {
				const plugins = await response.json();
				setPluginList(plugins);
			} else {
				notify("Failed to load plugin list");
			}
		})();
	}, []);

	async function generateToken() {
		let values = form.getFieldsValue();
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
		setSlaveId(slaveId);
	}

	// Generate a new random
	useEffect(() => {
		if (visible) {
			generateToken().catch(notifyErrorHandler("Error generating token"));
		}
	}, [visible]);

	// Only install plugins that aren't filesystem paths. Npm modules have max 1 forward slash in their name.
	const pluginString = pluginList.map(p => `"${p.requirePath}"`).filter(x => x.split("/") <= 1).join(" ");
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
			width="700px"
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="slaveId" label="Slave ID">
					<Input onChange={() => { generateToken().catch(notifyErrorHandler("Error generating token")); }} />
				</Form.Item>
			</Form>
			{token !== null && <>
				<Typography.Paragraph>
					Slave auth token:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied auth token to clipboard"}
						text={token}
					/>
					{token}
				</div>
				<Typography.Paragraph>
					You can set the token on an existing slave with the following command:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied configuration commands to clipboard"}
						text={`npx clusterioslave config set slave.master_token ${token}
							   npx clusterioslave config set slave.id ${slaveId}`}
					/>
					<p>npx clusterioslave config set slave.master_token &lt;token&gt;</p>
					<p>npx clusterioslave config set slave.id &lt;slaveId&gt;</p>
				</div>
				<Typography.Paragraph>
					Example slave setup commands:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied slave setup commands to clipboard"}
						text={`
							mkdir clusterio
							cd clusterio
							`+
							// eslint-disable-next-line max-len
							`npm init "@clusterio" -- --master-token ${token} --mode "slave" --download-headless --master-url ${document.location.origin}/ --slave-name "Slave ${slaveId || "?"}" --public-address localhost ${pluginString.length ? "--plugins" : ""} ${pluginString}`
						}/>
					<p>&gt; mkdir clusterio</p>
					<p>&gt; cd clusterio</p>
					<p>
						&gt; npm init "@clusterio" --
						--master-token <span className="highlight">{token} </span>
						--mode "slave"
						--download-headless
						--master-url <span className="highlight">{document.location.origin}/ </span>
						--slave-name <span className="highlight">"Slave {slaveId || "?"}" </span>
						--public-address <span className="highlight">localhost </span>
						{pluginString.length ? "--plugins" : ""} <span className="highlight">{pluginString}</span>
					</p>
					<p>&gt; ./run-slave</p>
				</div>
			</>}
		</Modal>
	</>;
}

function CopyButton({ text, message }) {
	let [clipboardPermision, setClipboardPermission] = useState("granted");
	useEffect(() => {
		(async () => {
			let result = await navigator.permissions.query({ name: "clipboard-write" });
			// result.state is "granted", "denied" or "prompt"
			setClipboardPermission(result.state);
			result.onchange = function () {
				setClipboardPermission(result.state);
			};
		})();
	}, []);

	async function checkClipboardPermission() {
		let result = await navigator.permissions.query({ name: "clipboard-write" });
		// result.state is "granted", "denied" or "prompt"
		setClipboardPermission(result.state);
		result.onchange = function () {
			setClipboardPermission(result.state);
		};
		return result.state === "granted";
	}

	return <Button
		className="copy-button"
		danger={clipboardPermision !== "granted"}
		onClick={async () => {
			if (await checkClipboardPermission()) {
				navigator.clipboard.writeText(text);
				notify(message);
			}
		}}
	>
		<CopyOutlined />
	</Button>;
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
					title: "Public address",
					dataIndex: "public_address",
					sorter: (a, b) => strcmp(a["public_address"], b["public_address"]),
				},
				{
					title: "Connected",
					key: "connected",
					render: slave => <Tag
						color={slave["connected"] ? "#389e0d" : "#cf1322"}
					>
						{slave["connected"] ? "Connected" : "Disconnected"}
					</Tag>,
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
		<PluginExtra component="SlavesPage" />
	</PageLayout>;
};
