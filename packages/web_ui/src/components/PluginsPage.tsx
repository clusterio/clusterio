import React, { useContext, useEffect, useState } from "react";
import { Table } from "antd";
import CloseCircleFilled from "@ant-design/icons/CloseCircleFilled";
import InfoCircleFilled from "@ant-design/icons/InfoCircleFilled";

import type { PluginWebApi, PluginWebpackEnvInfo } from "@clusterio/lib";

import notify from "../util/notify";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PageHeader from "./PageHeader";
import useTableQueryState from "../util/useTableQueryState";
import useColumnSearch from "../util/useColumnSearch";
import useRowNavigation from "../util/useRowNavigation";
import Link from "./Link";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

type PluginRow = {
	meta: PluginWebApi;
	info?: PluginWebpackEnvInfo;
	package?: any;
};


export default function PluginsPage() {
	const control = useContext(ControlContext);
	let [pluginList, setPluginList] = useState<PluginWebApi[]>([]);
	const tableState = useTableQueryState<PluginRow>({
		namespace: "plugin", defaultSortKey: "name",
	});
	const nameSearch = useColumnSearch<PluginRow>(
		tableState, "name", plugin => (plugin.info ? plugin.info.title : plugin.meta.name), "Search plugins"
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
		if (control.plugins.has(meta.name)) {
			let plugin = control.plugins.get(meta.name)!;
			tableContents.push({
				meta,
				info: plugin.info,
				package: plugin.package,
			});
		} else {
			tableContents.push({
				meta,
				info: control.pluginInfos.get(meta.name),
			});
		}
	}

	return <PageLayout nav={[{ name: "Plugins" }]}>
		<PageHeader title="Plugins" />
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					className: "table-link-cell",
					render: (_, plugin) => <Link
						to={`/plugins/${plugin.meta.name}/view`}
						style={{ color: "inherit" }}
					>
						{plugin.info ? plugin.info.title : plugin.meta.name}
					</Link>,
					sorter: (a, b) => strcmp(a.info ? a.info.title : a.meta.name, b.info ? b.info.title : b.meta.name),
					sortOrder: tableState.sortOrder("name"),
					filteredValue: tableState.filteredValue("name"),
					...nameSearch,
				},
				{
					title: "Version",
					key: "version",
					render: (_, plugin) => {
						if (!plugin.meta.enabled) {
							return <><InfoCircleFilled style={{ color: "#1668dc" }} /> Disabled on controller</>;
						}
						// Plugins are loaded once when the page starts, so one the
						// controller has picked up since then was never attempted
						// rather than attempted and failed. A plugin the controller
						// cannot serve at all is excluded before it gets that far,
						// and is a real error.
						if (!plugin.meta.web.error && !control.pluginInfos.has(plugin.meta.name)) {
							return <><InfoCircleFilled style={{ color: "#1668dc" }} /> Reload page to load</>;
						}
						if (!plugin.package) {
							return <><CloseCircleFilled style={{ color: "#dc4446" }} /> Error loading module</>;
						}
						if (plugin.package.version !== plugin.meta.version) {
							return "Version missmatched";
						}
						return plugin.package.version;
					},
					sorter: (a, b) => strcmp(a.meta.version, b.meta.version),
					sortOrder: tableState.sortOrder("version"),
				},
				{
					title: "Loaded",
					key: "loaded",
					render: (_, plugin) => (plugin.package ? "Yes" : null),
					sorter: (a, b) => Number(Boolean(a.package)) - Number(Boolean(b.package)),
					sortOrder: tableState.sortOrder("loaded"),
					responsive: ["sm"],
				},
			]}
			dataSource={tableContents}
			rowKey={plugin => plugin.meta.name}
			pagination={tableState.pagination}
			onChange={tableState.onChange}
			onRow={plugin => rowNav(`/plugins/${plugin.meta.name}/view`)}
		/>
	</PageLayout>;
}
