import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table } from "antd";
import CloseCircleFilled from "@ant-design/icons/CloseCircleFilled";
import InfoCircleFilled from "@ant-design/icons/InfoCircleFilled";

import type { PluginWebApi } from "@clusterio/lib";

import notify from "../util/notify";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PageHeader from "./PageHeader";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


export default function PluginsPage() {
	const control = useContext(ControlContext);
	let navigate = useNavigate();
	let [pluginList, setPluginList] = useState<PluginWebApi[]>([]);

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
					render: (_, plugin) => (plugin.info ? plugin.info.title : plugin.meta.name),
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.info ? a.info.title : a.meta.name, b.info ? b.info.title : b.meta.name),
				},
				{
					title: "Version",
					key: "version",
					render: (_, plugin) => {
						if (!plugin.meta.enabled) {
							return <><InfoCircleFilled style={{ color: "#1668dc" }} /> Disabled on controller</>;
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
				},
				{
					title: "Loaded",
					key: "loaded",
					render: (_, plugin) => (plugin.package ? "Yes" : null),
					sorter: (a, b) => Number(Boolean(a.package)) - Number(Boolean(b.package)),
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
