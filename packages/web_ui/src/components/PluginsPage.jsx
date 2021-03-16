import React, { useContext, useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { Table } from "antd";

import notify from "../util/notify";
import PluginsContext from "./PluginsContext";
import PageLayout from "./PageLayout";


export default function PluginsPage() {
	let plugins = useContext(PluginsContext);
	let history = useHistory();
	let [pluginList, setPluginList] = useState([]);

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

	let tableContents = [];
	for (let meta of pluginList) {
		if (plugins.has(meta.name)) {
			let plugin = plugins.get(meta.name);
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
				},
				{
					title: "Loaded",
					dataIndex: ["meta", "loaded"],
					render: loaded => (loaded ? "Yes" : null),
					responsive: ["sm"],
				},
			]}
			dataSource={tableContents}
			rowKey={plugin => plugin.meta.name}
			pagination={false}
			onRow={plugin => ({
				onClick: event => {
					history.push(`/plugins/${plugin.meta.name}/view`);
				},
			})}
		/>
	</PageLayout>;
}
