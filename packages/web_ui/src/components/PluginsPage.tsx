import React, { useContext, useEffect, useState } from "react";
import { Space, Table, Typography } from "antd";
import CloseCircleFilled from "@ant-design/icons/CloseCircleFilled";
import InfoCircleFilled from "@ant-design/icons/InfoCircleFilled";

import type { PluginWebApi, PluginWebpackEnvInfo } from "@clusterio/lib";

import notify from "../util/notify";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import { PluginBrowserButton } from "./PluginBrowser";
import { usePluginInstaller } from "./PluginInstall";
import {
	PluginUpdateButton, PluginVersions, RestartPendingButton, UpdateAllButton, useLatestVersions, useMachinePlugins,
} from "./PluginClusterStatus";
import { PluginStatus, computePluginStatuses, pluginStatusKey } from "../util/plugin_status";
import PageLayout from "./PageLayout";
import PageHeader from "./PageHeader";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "../util/useColumnSearch";
import useRowNavigation from "../util/useRowNavigation";
import Link from "./Link";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

type PluginRow = {
	key: string;
	title: string;
	/** Not present for plugins the controller hasn't loaded */
	meta?: PluginWebApi;
	info?: PluginWebpackEnvInfo;
	package?: any;
	status?: PluginStatus;
};

function WebUiStatus(props: { plugin: PluginRow }) {
	const control = useContext(ControlContext);
	const { meta } = props.plugin;
	if (!meta) {
		return <Typography.Text type="secondary">Not on controller</Typography.Text>;
	}
	if (!meta.enabled) {
		return <><InfoCircleFilled style={{ color: "#1668dc" }} /> Disabled on controller</>;
	}
	if (!meta.web.main && !meta.web.error) {
		return <Typography.Text type="secondary">No web module</Typography.Text>;
	}
	if (!meta.web.error && !control.pluginInfos.has(meta.name)) {
		return <><InfoCircleFilled style={{ color: "#1668dc" }} /> Reload page to load</>;
	}
	if (!props.plugin.package) {
		return <><CloseCircleFilled style={{ color: "#dc4446" }} /> Error loading module</>;
	}
	if (props.plugin.package.version !== meta.version) {
		return <><CloseCircleFilled style={{ color: "#dc4446" }} /> Version mis-matched</>;
	}
	return <>Loaded</>;
}


export default function PluginsPage() {
	const control = useContext(ControlContext);
	const account = useAccount();
	let [pluginList, setPluginList] = useState<PluginWebApi[]>([]);
	const tableState = useTableQueryState<PluginRow>({
		namespace: "plugin", defaultSortKey: "name",
	});
	const nameSearch = useColumnSearch<PluginRow>(
		tableState, "name", plugin => plugin.title, "Search plugins"
	);
	const { machines, unreachable, refresh } = useMachinePlugins();
	const installer = usePluginInstaller(refresh);
	const statuses = machines ? computePluginStatuses(machines, unreachable) : new Map<string, PluginStatus>();
	const latestVersions = useLatestVersions(
		[...statuses.values()].flatMap(status => (status.npmPackage ? [status.npmPackage] : []))
	);
	const rowNav = useRowNavigation();

	useEffect(() => {
		(async () => {
			let response = await fetch(`${webRoot}api/plugins`);
			if (response.ok) {
				setPluginList(await response.json());
			} else {
				notify("Failed to load plugin list");
			}
		})();
	}, []);

	let tableContents: PluginRow[] = [];
	for (let meta of pluginList) {
		const key = pluginStatusKey(meta);
		const loaded = control.loadedPlugins.get(meta.name);
		const info = loaded ?? control.pluginInfos.get(meta.name);
		tableContents.push({
			key,
			title: info ? info.title : meta.name,
			meta,
			info,
			package: loaded?.package,
			status: statuses.get(key),
		});
	}
	// Plugins installed on hosts, or waiting for a restart, that the controller hasn't loaded
	const listedKeys = new Set(tableContents.map(row => row.key));
	for (const status of statuses.values()) {
		if (!listedKeys.has(status.key)) {
			tableContents.push({ key: status.key, title: status.title, status });
		}
	}
	const latestOf = (plugin: PluginRow) => (
		plugin.status?.npmPackage ? latestVersions[plugin.status.npmPackage] : undefined
	);

	return <PageLayout nav={[{ name: "Plugins" }]}>
		<PageHeader
			title="Plugins"
			extra={<Space wrap>
				{machines && <RestartPendingButton
					statuses={[...statuses.values()]} machines={machines} busy={installer.installing}
				/>}
				<UpdateAllButton
					statuses={[...statuses.values()]}
					titles={new Map(tableContents.map(row => [row.key, row.title]))}
					latestVersions={latestVersions}
					installer={installer}
				/>
				{account.hasPermission("core.plugin.search")
					&& <PluginBrowserButton statuses={machines && statuses} installer={installer} />}
			</Space>}
		/>
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					className: "table-link-cell",
					render: (_, plugin) => (plugin.meta
						? <Link to={`/plugins/${plugin.meta.name}/view`} style={{ color: "inherit" }}>
							{plugin.title}
						</Link>
						: plugin.title
					),
					sorter: (a, b) => strcmp(a.title, b.title),
					sortOrder: tableState.sortOrder("name"),
					filteredValue: tableState.filteredValue("name"),
					...nameSearch,
				},
				{
					title: "Versions",
					key: "versions",
					render: (_, plugin) => (plugin.status
						? <PluginVersions status={plugin.status} latest={latestOf(plugin)} />
						: plugin.meta?.version
					),
				},
				{
					title: "Web UI",
					key: "web",
					render: (_, plugin) => <WebUiStatus plugin={plugin} />,
					responsive: ["sm"],
				},
				{
					key: "actions",
					align: "right",
					render: (_, plugin) => (plugin.status
						// Keep clicks on the update action from opening the plugin
						? <span onClick={event => { event.stopPropagation(); }}>
							<PluginUpdateButton
								status={plugin.status}
								title={plugin.title}
								latest={latestOf(plugin)}
								installer={installer}
							/>
						</span>
						: null
					),
				},
			]}
			dataSource={tableContents}
			rowKey={plugin => plugin.key}
			pagination={tableState.pagination}
			onChange={tableState.onChange}
			onRow={plugin => (plugin.meta ? rowNav(`/plugins/${plugin.meta.name}/view`) : {})}
		/>
	</PageLayout>;
}
