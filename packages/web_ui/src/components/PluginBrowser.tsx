import { useContext, useEffect, useState } from "react";
import { Button, Descriptions, Input, Modal, Select, Space, Table, Typography } from "antd";
import SearchOutlined from "@ant-design/icons/SearchOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import { InstallTarget, PluginInstaller, RemoteInstallDisabledNotice, addressKey } from "./PluginInstall";
import { PluginInstalledTag, PluginUpdateButton, PluginVersions } from "./PluginClusterStatus";
import type { PluginStatus } from "../util/plugin_status";

const { Text, Link } = Typography;

/** Statuses are undefined until the plugin lists of the machines have loaded, or without core.plugin.list */
type BrowserProps = { statuses?: Map<string, PluginStatus>, installer: PluginInstaller };

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

// Installs on the chosen machines, defaulting to every connected machine that allows installs.
function InstallControls(props: { plugin: lib.PluginSearchResult, installer: PluginInstaller }) {
	const account = useAccount();
	const [hosts] = useHosts();
	// Tracks what was deselected so machines connecting later, or allowing installs, start selected
	const [deselected, setDeselected] = useState(new Set<string>());
	const { access, installing } = props.installer;

	const machines: (InstallTarget & { key: string, allowed: boolean })[] = [
		{ name: "Controller", address: "controller" as lib.AddressShorthand },
		...[...hosts.values()]
			.filter(host => host.connected)
			.sort((a, b) => strcmp(a.name, b.name))
			.map(host => ({ name: host.name, address: { hostId: host.id } as lib.AddressShorthand })),
	].map(target => ({ ...target, key: addressKey(target.address), allowed: access.canInstall(target.address) }));
	const selected = machines.filter(machine => machine.allowed && !deselected.has(machine.key));
	const blocked = machines.filter(machine => !machine.allowed);

	return <Space direction="vertical" style={{ width: "100%" }}>
		<Space wrap>
			<Text>Install on</Text>
			<Select
				mode="multiple"
				style={{ minWidth: 260 }}
				placeholder="Select machines"
				optionFilterProp="label"
				value={selected.map(machine => machine.key)}
				onChange={keys => {
					setDeselected(new Set(machines.filter(machine => !keys.includes(machine.key)).map(m => m.key)));
				}}
				options={machines.map(machine => ({
					value: machine.key,
					label: machine.allowed ? machine.name : `${machine.name} (remote installs disabled)`,
					disabled: !machine.allowed,
				}))}
			/>
			<Button
				type="primary"
				loading={installing}
				disabled={!account.hasPermission("core.plugin.install") || !selected.length}
				onClick={() => { props.installer.install(props.plugin.name, selected); }}
			>Install</Button>
		</Space>
		{blocked.length > 0 && <RemoteInstallDisabledNotice
			controller={blocked.some(machine => machine.address === "controller")}
			hosts={blocked.filter(machine => machine.address !== "controller").map(machine => machine.name)}
		/>}
	</Space>;
}

function PluginDetails(props: { plugin: lib.PluginSearchResult } & BrowserProps) {
	const account = useAccount();
	const { plugin } = props;
	const status = props.statuses?.get(plugin.name);
	// Without list permission the statuses never load, so offer installs without them
	const statusesKnown = props.statuses !== undefined || !account.hasPermission("core.plugin.list");
	// Links come from package metadata on npm, only http(s) links are shown so they can't run scripts
	const links = [
		{ label: "npm", url: lib.safeExternalUrl(plugin.npm) },
		{ label: "Homepage", url: lib.safeExternalUrl(plugin.homepage) },
		{ label: "Repository", url: lib.safeExternalUrl(plugin.repository) },
	].filter(link => link.url !== undefined);
	return <>
		<Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
			<Descriptions.Item label="Package">{plugin.name}</Descriptions.Item>
			<Descriptions.Item label="Version">{plugin.version}</Descriptions.Item>
			{status && <Descriptions.Item label="Installed">
				<PluginVersions status={status} latest={plugin.version} />
				<div style={{ marginTop: 4 }}>
					<PluginUpdateButton status={status} latest={plugin.version} installer={props.installer} />
				</div>
			</Descriptions.Item>}
			{plugin.description && <Descriptions.Item label="Description">{plugin.description}</Descriptions.Item>}
			{plugin.publisher && <Descriptions.Item label="Publisher">{plugin.publisher}</Descriptions.Item>}
			{plugin.date && <Descriptions.Item label="Published">
				{new Date(plugin.date).toLocaleString()}
			</Descriptions.Item>}
			{links.length > 0 && <Descriptions.Item label="Links">
				<Space wrap>
					{links.map(link => <Link key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">
						{link.label}
					</Link>)}
				</Space>
			</Descriptions.Item>}
		</Descriptions>
		{/* Installed plugins are brought in line by the update action above instead */}
		{statusesKnown && !status && <InstallControls plugin={plugin} installer={props.installer} />}
	</>;
}

export function PluginBrowserButton(props: BrowserProps) {
	const control = useContext(ControlContext);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [loading, setLoading] = useState(false);
	const [total, setTotal] = useState(0);
	const [results, setResults] = useState<lib.PluginSearchResult[]>([]);
	const [selected, setSelected] = useState<lib.PluginSearchResult | undefined>();

	useEffect(() => {
		if (!open) {
			return;
		}
		setLoading(true);
		let canceled = false;
		control.send(new lib.PluginSearchRequest(query, page, pageSize)).then(response => {
			if (canceled) { return; }
			setTotal(response.total);
			setResults(response.results);
			setSelected(current => response.results.find(r => r.name === current?.name));
		}).catch(notifyErrorHandler("Error searching for plugins")).finally(() => {
			if (!canceled) { setLoading(false); }
		});
		// eslint-disable-next-line consistent-return
		return () => { canceled = true; };
	}, [open, query, page, pageSize]);

	return <>
		<Button icon={<SearchOutlined />} onClick={() => { setOpen(true); }}>Browse plugins</Button>
		<Modal
			title="Browse plugins"
			open={open}
			onCancel={() => { setOpen(false); }}
			width={1000}
			footer={<Button onClick={() => { setOpen(false); }}>Close</Button>}
		>
			<Input.Search
				placeholder="Search npm for plugins"
				allowClear
				enterButton
				style={{ marginBottom: 16 }}
				onSearch={value => { setQuery(value); setPage(1); }}
			/>
			<Table
				size="small"
				loading={loading}
				dataSource={results}
				rowKey="name"
				rowClassName={plugin => (plugin.name === selected?.name ? "ant-table-row-selected" : "")}
				onRow={plugin => ({ onClick: () => { setSelected(plugin); }, style: { cursor: "pointer" } })}
				pagination={{
					current: page,
					pageSize,
					total,
					showSizeChanger: true,
					onChange: (newPage, newPageSize) => { setPage(newPage); setPageSize(newPageSize); },
				}}
				columns={[
					{
						title: "Name",
						key: "name",
						render: (_, plugin) => {
							const status = props.statuses?.get(plugin.name);
							return <>
								{plugin.name}
								{status && <span style={{ marginLeft: 8 }}>
									<PluginInstalledTag status={status} latest={plugin.version} />
								</span>}
							</>;
						},
					},
					{ title: "Version", dataIndex: "version", key: "version", width: 120 },
					{ title: "Publisher", dataIndex: "publisher", key: "publisher", width: 160, responsive: ["md"] },
					{
						title: "Description",
						dataIndex: "description",
						key: "description",
						ellipsis: true,
						responsive: ["lg"],
					},
				]}
			/>
			{selected
				? <PluginDetails plugin={selected} statuses={props.statuses} installer={props.installer} />
				: <Text type="secondary">Select a plugin to see details and install it.</Text>
			}
		</Modal>
	</>;
}
