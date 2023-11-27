import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table } from "antd";

import type { PluginWebApi } from "@clusterio/lib";

import notify from "../util/notify";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


export default function PluginsPage() {
	let plugins = useContext(ControlContext).plugins;
	let navigate = useNavigate();
	let [pluginList, setPluginList] = useState<PluginWebApi[]>([]);

	useEffect(() => {
		(async () => {
			let response = await fetch(`${window.webRoot}api/plugins`);
			if (response.ok) {
				setPluginList(await response.json());
			} else {
				notify("Failed to load plugin list");
			}
		})();
	}, []);

	let tableContents = [];
	for (let meta of pluginList) {
		if (plugins.has(meta.name)) {
			let plugin = plugins.get(meta.name)!;
			tableContents.push({
				meta,
				info: plugin.info,
				package: plugin.package,
			});
		} else {
			tableContents.push({
				meta,
			});
		}
	}

	return <PageLayout nav={[{ name: "Plugins" }]}>
		<h2>Plugins</h2>
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					render: plugin => (plugin.info ? plugin.info.title : plugin.meta.name),
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.info ? a.info.title : a.meta.name, b.info ? b.info.title : b.meta.name),
				},
				{
					title: "Version",
					key: "version",
					render: plugin => {
						if (!plugin.package) {
							return "Error loading module";
						}
						if (plugin.package.version !== plugin.meta.version) {
							return "Version missmatched";
						}
						return plugin.package.version;
					},
					sorter: (a, b) => strcmp(a.meta.version, b.meta.version),
				},
				{
					title: "Loaded",
					dataIndex: ["meta", "loaded"],
					render: loaded => (loaded ? "Yes" : null),
					sorter: (a, b) => Number(a.meta.loaded) - Number(b.meta.loaded),
					responsive: ["sm"],
				},
			]}
			dataSource={tableContents}
			rowKey={plugin => plugin.meta.name}
			pagination={false}
			onRow={plugin => ({
				onClick: event => {
					navigate(`/plugins/${plugin.meta.name}/view`);
				},
			})}
		/>
	</PageLayout>;
}
