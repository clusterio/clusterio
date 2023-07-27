import React, { useContext, useRef, useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, InputNumber, Modal, PageHeader, Table, Tag, Typography } from "antd";
import CopyOutlined from "@ant-design/icons/lib/icons/CopyOutlined";

import { libData } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useHostList } from "../model/host";
import notify, { notifyErrorHandler } from "../util/notify";

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


function GenerateHostTokenButton(props) {
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [token, setToken] = useState(null);
	let [hostId, setHostId] = useState(null);
	let [form] = Form.useForm();
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
		let id = null;
		let values = form.getFieldsValue();
		if (values.hostId) {
			id = Number.parseInt(values.hostId, 10);
			if (Number.isNaN(id)) {
				form.setFields([{ name: "hostId", errors: ["Must be an integer"] }]);
				return;
			}
			form.setFields([{ name: "hostId", errors: [] }]);
		}

		let newToken = await control.send(new libData.HostGenerateTokenRequest(id));
		setToken(newToken);
		setHostId(id);
	}

	// Generate a new random
	useEffect(() => {
		if (open) {
			generateToken().catch(notifyErrorHandler("Error generating token"));
		}
	}, [open]);

	// Only install plugins that aren't filesystem paths. Npm modules have max 1 forward slash in their name.
	const pluginString = pluginList.map(p => `"${p.requirePath}"`).filter(x => x.split("/") <= 1).join(" ");
	return <>
		<Button
			onClick={() => { setOpen(true); }}
		>Generate Token</Button>
		<Modal
			title="Generate Host Token"
			open={open}
			footer={null}
			onCancel={() => {
				setOpen(false);
				setToken(null);
				form.resetFields();
			}}
			width="700px"
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="hostId" label="Host ID">
					<InputNumber onChange={() => {
						generateToken().catch(notifyErrorHandler("Error generating token"));
					}} />
				</Form.Item>
			</Form>
			{token !== null && <>
				<Typography.Paragraph>
					Host auth token:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied auth token to clipboard"}
						text={token}
					/>
					{token}
				</div>
				<Typography.Paragraph>
					You can set the token on an existing host with the following command:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied configuration commands to clipboard"}
						text={`npx clusteriohost config set host.controller_token ${token}
							   npx clusteriohost config set host.id ${hostId}`}
					/>
					<p>npx clusteriohost config set host.controller_token &lt;token&gt;</p>
					<p>npx clusteriohost config set host.id &lt;hostId&gt;</p>
				</div>
				<Typography.Paragraph>
					Example host setup commands:
				</Typography.Paragraph>
				<div className="codeblock">
					<CopyButton
						message={"Copied host setup commands to clipboard"}
						text={`
							mkdir clusterio
							cd clusterio
							`+
							// eslint-disable-next-line max-len
							`npm init "@clusterio" -- --controller-token ${token} --mode "host" --download-headless --controller-url ${document.location.origin}/ --host-name "Host ${hostId || "?"}" --public-address localhost ${pluginString.length ? "--plugins" : ""} ${pluginString}`
						}/>
					<p>&gt; mkdir clusterio</p>
					<p>&gt; cd clusterio</p>
					<p>
						&gt; npm init "@clusterio" --
						--controller-token <span className="highlight">{token} </span>
						--mode "host"
						--download-headless
						--controller-url <span className="highlight">{document.location.origin}/ </span>
						--host-name <span className="highlight">"Host {hostId || "?"}" </span>
						--public-address <span className="highlight">localhost </span>
						{pluginString.length ? "--plugins" : ""} <span className="highlight">{pluginString}</span>
					</p>
					<p>&gt; ./run-host</p>
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


export default function HostsPage() {
	let account = useAccount();
	let history = useHistory();
	let [hostList] = useHostList();

	return <PageLayout nav={[{ name: "Hosts" }]}>
		<PageHeader
			className="site-page-header"
			title="Hosts"
			extra={account.hasPermission("core.host.generate_token") && <GenerateHostTokenButton />}
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
					title: "Agent",
					dataIndex: "agent",
					sorter: (a, b) => strcmp(a.agent, b.agent),
					responsive: ["lg"],
				},
				{
					title: "Version",
					dataIndex: "version",
					sorter: (a, b) => strcmp(a.version, b.version),
				},
				{
					title: "Public address",
					dataIndex: "publicAddress",
					sorter: (a, b) => strcmp(a.publicAddress, b.publicAddress),
				},
				{
					title: "Connected",
					key: "connected",
					render: host => <Tag
						color={host.connected ? "#389e0d" : "#cf1322"}
					>
						{host.connected ? "Connected" : "Disconnected"}
					</Tag>,
					sorter: (a, b) => a.connected - b.connected,
				},
			]}
			dataSource={hostList}
			rowKey={host => host.id}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					history.push(`/hosts/${record.id}/view`);
				},
			})}
		/>
		<PluginExtra component="HostsPage" />
	</PageLayout>;
};
