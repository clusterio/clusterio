import React, { useContext } from "react";
import { useHistory } from "react-router-dom";
import { Table } from "antd";

import PluginsContext from "./PluginsContext";
import PageLayout from "./PageLayout";


export default function PluginsPage() {
	let plugins = useContext(PluginsContext);
	let history = useHistory();

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
					title: "Enabled",
					dataIndex: ["meta", "enabled"],
					render: enabled => (enabled ? "Yes" : null),
					responsive: ["sm"],
				},
			]}
			dataSource={plugins}
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
