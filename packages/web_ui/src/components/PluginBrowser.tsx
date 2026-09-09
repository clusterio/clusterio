import { useContext, useEffect, useState } from "react";
import { Button, Descriptions, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import SearchOutlined from "@ant-design/icons/SearchOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useHosts } from "../model/host";
import notify, { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";

const { Text, Link } = Typography;

type InstallTarget = { name: string, address: lib.AddressShorthand };

// Which targets accept remote plugin installs, assumed true when the config can't be read.
function useInstallAllowed() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts] = useHosts();
	const [controllerAllowed, setControllerAllowed] = useState(true);
	const [hostsAllowed, setHostsAllowed] = useState(new Map<number, boolean>());
	const connectedHostIds = [...hosts.values()].filter(host => host.connected).map(host => host.id);

	useEffect(() => {
		if (!account.hasPermission("core.controller.get_config")) {
			return;
		}
		control.send(new lib.ControllerConfigGetRequest()).then(serializedConfig => {
			const config = lib.ControllerConfig.fromJSON(serializedConfig, "control");
			setControllerAllowed(config.get("controller.allow_plugin_install"));
		}).catch(notifyErrorHandler("Failed to fetch controller config"));
	}, []);

	useEffect(() => {
		if (!account.hasPermission("core.host.get_config")) {
			return;
		}
		Promise.all(connectedHostIds.map(async hostId => {
			try {
				const serializedConfig = await control.sendTo({ hostId }, new lib.HostConfigGetRequest());
				const config = lib.HostConfig.fromJSON(serializedConfig, "control");
				return [hostId, config.get("host.allow_plugin_install")] as const;
			} catch (err) {
				return [hostId, true] as const;
			}
		})).then(entries => { setHostsAllowed(new Map(entries)); });
	}, [connectedHostIds.join(",")]);

	return {
		controller: controllerAllowed,
		host: (hostId: number) => hostsAllowed.get(hostId) ?? true,
	};
}

function InstallControls(props: { plugin: lib.PluginSearchResult }) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts] = useHosts();
	const allowed = useInstallAllowed();
	const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
	const [installing, setInstalling] = useState(false);

	const connectedHosts = [...hosts.values()].filter(host => host.connected);
	const eligibleHosts = connectedHosts.filter(host => allowed.host(host.id));
	const canInstall = account.hasPermission("core.plugin.install");

	async function install(targets: InstallTarget[]) {
		setInstalling(true);
		try {
			const results = await Promise.allSettled(targets.map(
				target => control.sendTo(target.address, new lib.PluginInstallRequest(props.plugin.name))
			));
			const installed = targets.filter((_, i) => results[i].status === "fulfilled");
			if (installed.length) {
				notify(
					`Installed ${props.plugin.name}`, "success",
					`Installed on ${installed.map(t => t.name).join(", ")}. A restart is required to load it.`,
				);
			}
			results.forEach((result, i) => {
				if (result.status === "rejected") {
					notifyErrorHandler(`Failed to install ${props.plugin.name} on ${targets[i].name}`)(result.reason);
				}
			});
		} finally {
			setInstalling(false);
		}
	}

	const hostTarget = (host: lib.HostDetails): InstallTarget => ({ name: host.name, address: { hostId: host.id } });

	return <Space wrap>
		<Button
			type="primary"
			loading={installing}
			disabled={!canInstall || !allowed.controller}
			onClick={() => { install([{ name: "controller", address: "controller" }]); }}
		>Install to controller</Button>
		<Select
			mode="multiple"
			style={{ minWidth: 200 }}
			placeholder="Select hosts"
			value={selectedHostIds}
			onChange={setSelectedHostIds}
			options={connectedHosts.map(host => ({
				value: host.id,
				label: allowed.host(host.id) ? host.name : `${host.name} (remote install disabled)`,
				disabled: !allowed.host(host.id),
			}))}
		/>
		<Button
			loading={installing}
			disabled={!canInstall || !selectedHostIds.length}
			onClick={() => {
				install(connectedHosts.filter(host => selectedHostIds.includes(host.id)).map(hostTarget));
			}}
		>Install to selected hosts</Button>
		<Button
			loading={installing}
			disabled={!canInstall || !eligibleHosts.length}
			onClick={() => { install(eligibleHosts.map(hostTarget)); }}
		>Install to all hosts</Button>
	</Space>;
}

function PluginDetails(props: { plugin: lib.PluginSearchResult }) {
	const { plugin } = props;
	return <>
		<Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
			<Descriptions.Item label="Package">{plugin.name}</Descriptions.Item>
			<Descriptions.Item label="Version">{plugin.version}</Descriptions.Item>
			{plugin.description && <Descriptions.Item label="Description">{plugin.description}</Descriptions.Item>}
			{plugin.publisher && <Descriptions.Item label="Publisher">{plugin.publisher}</Descriptions.Item>}
			{plugin.date && <Descriptions.Item label="Published">
				{new Date(plugin.date).toLocaleString()}
			</Descriptions.Item>}
			<Descriptions.Item label="Links">
				<Space wrap>
					{plugin.npm && <Link href={plugin.npm} target="_blank">npm</Link>}
					{plugin.homepage && <Link href={plugin.homepage} target="_blank">Homepage</Link>}
					{plugin.repository && <Link href={plugin.repository} target="_blank">Repository</Link>}
				</Space>
			</Descriptions.Item>
		</Descriptions>
		<InstallControls plugin={plugin} />
	</>;
}

export function PluginBrowserButton() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [loading, setLoading] = useState(false);
	const [total, setTotal] = useState(0);
	const [results, setResults] = useState<lib.PluginSearchResult[]>([]);
	const [selected, setSelected] = useState<lib.PluginSearchResult | undefined>();
	const [installed, setInstalled] = useState(new Set<string>());

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

	useEffect(() => {
		if (!open || !account.hasPermission("core.plugin.list")) {
			return;
		}
		control.send(new lib.PluginListRequest()).then(plugins => {
			setInstalled(new Set(plugins.flatMap(p => (p.npmPackage ? [p.npmPackage] : []))));
		}).catch(notifyErrorHandler("Error fetching installed plugins"));
	}, [open]);

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
						render: (_, plugin) => <>
							{plugin.name}
							{installed.has(plugin.name) && <Tag style={{ marginLeft: 8 }}>Installed on controller</Tag>}
						</>,
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
				? <PluginDetails plugin={selected} />
				: <Text type="secondary">Select a plugin to see details and install it.</Text>
			}
		</Modal>
	</>;
}
