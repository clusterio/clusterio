import React, { useEffect, useContext, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Descriptions, Spin } from "antd";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";


export default function PluginViewPage() {
	let params = useParams();
	let plugins = useContext(ControlContext).plugins;
	let [pluginList, setPluginList] = useState(null);
	let pluginName = params.name;

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

	let plugin = plugins.get(pluginName);
	let pluginTitle = plugin ? plugin.info.title : pluginName;
	let nav = [{ name: "Plugins", path: "/plugins" }, { name: pluginTitle }];
	if (!pluginList) {
		return <PageLayout nav={nav}>
			<Descriptions borderd size="small" title={pluginTitle} />
			<Spin size="large" />
		</PageLayout>;
	}

	let pluginMeta = pluginList.find(p => p.name === pluginName);
	if (!pluginMeta) {
		return <PageLayout nav={nav}>
			<h2>Plugin not found</h2>
			<p>Plugin with name {pluginName} was not found on the master server.</p>
		</PageLayout>;
	}

	if (!plugin) {
		return <PageLayout nav={nav}>
			<Descriptions bordered size="small" title={pluginTitle}>
				<Descriptions.Item label="Version">{pluginMeta.version}</Descriptions.Item>
				<Descriptions.Item label="Loaded">{pluginMeta.loaded ? "Yes" : "No"}</Descriptions.Item>
			</Descriptions>
			<Alert
				style={{
					marginTop: "1em",
				}}
				message={pluginMeta.web.error || "Error loading web module"}
				description={
					"The web interface was unable to load the webpack module for this plugin. This is "+
					"usually due to an incorrect or missing webpack build for the plugin. Due to the "+
					"module not being loaded, the configs and web controls defined by this plugin will "+
					"not be available in the web interface."
				}
				type="error"
				showIcon
			/>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		<Descriptions bordered size="small" title={pluginTitle}>
			<Descriptions.Item label="Version">{pluginMeta.version}</Descriptions.Item>
			<Descriptions.Item label="Loaded" span={2}>{pluginMeta.loaded ? "Yes" : "No"}</Descriptions.Item>
			<Descriptions.Item label="Description" span={3}>{plugin.info.description}</Descriptions.Item>
			{plugin.package.homepage ? <Descriptions.Item label="Homepage" span={3}>
				<a href={plugin.package.homepage}>{plugin.package.homepage}</a>
			</Descriptions.Item> : null}
			{plugin.package.author ? <Descriptions.Item label="Author" span={3}>
				{plugin.package.author}
			</Descriptions.Item> : null}
			<Descriptions.Item label="License" span={3}>{plugin.package.license}</Descriptions.Item>
		</Descriptions>
		{pluginMeta.version !== plugin.package.version ? <Alert
			style={{
				marginTop: "1em",
			}}
			message="Version missmatch detected"
			description={
				`The version of the web interface module for this plugin (${plugin.package.version}) `+
				`does not match the version running on the master server (${pluginMeta.version}), `+
				"spurious errors may occur. This usually happens when the plugin is updated but the "+
				"master server has not been restarted yet, but may also be due to an outdated build."
			}
			type="warning"
			showIcon
		/> : null}
	</PageLayout>;
}
