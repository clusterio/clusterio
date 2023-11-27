import React, { useContext, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, InputNumber, Modal, Table, Tag, Typography } from "antd";
import CopyOutlined from "@ant-design/icons/lib/icons/CopyOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useHostList } from "../model/host";
import notify, { notifyErrorHandler } from "../util/notify";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


function GenerateHostTokenButton() {
	let control = useContext(ControlContext);
	let [open, setOpen] = useState(false);
	let [token, setToken] = useState<string|null>(null);
	let [hostId, setHostId] = useState<number|null>(null);
	let [form] = Form.useForm();
	let [pluginList, setPluginList] = useState<lib.PluginWebApi[]>([]);
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
		let id;
		let values = form.getFieldsValue();
		if (values.hostId) {
			id = Number.parseInt(values.hostId, 10);
			if (Number.isNaN(id)) {
				form.setFields([{ name: "hostId", errors: ["Must be an integer"] }]);
				return;
			}
			form.setFields([{ name: "hostId", errors: [] }]);
		}

		let newToken = await control.send(new lib.HostGenerateTokenRequest(id));
		setToken(newToken);
		setHostId(id??null);
	}

	// Generate a new random
	useEffect(() => {
		if (open) {
			generateToken().catch(notifyErrorHandler("Error generating token"));
		}
	}, [open]);

	// Only install plugins that aren't filesystem paths. Npm modules have max 1 forward slash in their name.
	const pluginString = pluginList.map(p => `"${p.requirePath}"`).filter(x => x.split("/").length <= 1).join(" ");
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
						text={`\
mkdir clusterio
cd clusterio
npm init "@clusterio" -- --controller-token ${token} --mode "host" --download-headless \
--controller-url ${document.location.origin}/ --host-name "Host ${hostId || "?"}" \
--public-address localhost ${pluginString.length ? "--plugins" : ""} ${pluginString}`
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

function CopyButton({ text, message }: { text:string, message:string }) {
	let [clipboardPermision, setClipboardPermission] = useState<PermissionState>("granted");
	useEffect(() => {
		(async () => {
			// @ts-expect-error missing API https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
			let result = await navigator.permissions.query({ name: "clipboard-write" });
			setClipboardPermission(result.state);
			result.onchange = function () {
				setClipboardPermission(result.state);
			};
		})();
	}, []);

	async function checkClipboardPermission() {
		try {
			// @ts-expect-error missing API https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
			let result = await navigator.permissions.query({ name: "clipboard-write" });
			setClipboardPermission(result.state);
			result.onchange = function () {
				setClipboardPermission(result.state);
			};
			return result.state === "granted";

		} catch (err: any) {
			// If it fail because "clipboard-write" is not supported.
			return err.name === "TypeError";
		}
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
	let navigate = useNavigate();
	let [hostList] = useHostList();

	return <PageLayout nav={[{ name: "Hosts" }]}>
		<PageHeader
			title="Hosts"
			extra={account.hasPermission("core.host.generate_token") && <GenerateHostTokenButton /> || undefined}
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
					sorter: (a, b) => strcmp(a.publicAddress??"", b.publicAddress??""),
				},
				{
					title: "Connected",
					key: "connected",
					render: host => <Tag
						color={host.connected ? "#389e0d" : "#cf1322"}
					>
						{host.connected ? "Connected" : "Disconnected"}
					</Tag>,
					sorter: (a, b) => Number(a.connected) - Number(b.connected),
				},
			]}
			dataSource={hostList}
			rowKey={host => host.id}
			pagination={false}
			onRow={(record, rowIndex) => ({
				onClick: event => {
					navigate(`/hosts/${record.id}/view`);
				},
			})}
		/>
		<PluginExtra component="HostsPage" />
	</PageLayout>;
};
