import React, { useEffect, useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Alert, Descriptions } from "antd";

import PluginsContext from "./PluginsContext";
import PageLayout from "./PageLayout";
import { notifyErrorHandler } from "../util/notify";


export default function PluginViewPage() {
	let params = useParams();
	let plugins = useContext(PluginsContext);
	let pluginName = params.name;

	let plugin = plugins.find(p => p.meta.name === pluginName);
	let pluginTitle = plugin.info ? plugin.info.title : plugin.meta.name;
	let nav = [{ name: "Plugins", path: "/plugins" }, { name: pluginTitle }];
	if (!plugin) {
		return <PageLayout nav={nav}>
			<h2>Plugin not found</h2>
			<p>Plugin with name {pluginName} was not found on the master server.</p>
		</PageLayout>;
	}

	if (!plugin.info) {
		return <PageLayout nav={nav}>
			<Descriptions
				bordered
				size="small"
				title={pluginTitle}
			>
				<Descriptions.Item label="Version">{plugin.meta.version}</Descriptions.Item>
				<Descriptions.Item label="Enabled">{plugin.meta.enabled ? "Yes" : "No"}</Descriptions.Item>
			</Descriptions>
			<Alert
				style={{
					marginTop: "1em",
				}}
				message="Error loading web module"
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
		<Descriptions
			bordered
			size="small"
			title={pluginTitle}
		>
			<Descriptions.Item label="Version">{plugin.meta.version}</Descriptions.Item>
			<Descriptions.Item label="Enabled" span={2}>{plugin.meta.enabled ? "Yes" : "No"}</Descriptions.Item>
			<Descriptions.Item label="Description" span={3}>{plugin.info.description}</Descriptions.Item>
			{plugin.package.homepage ? <Descriptions.Item label="Homepage" span={3}>
				<a href={plugin.package.homepage}>{plugin.package.homepage}</a>
			</Descriptions.Item> : null}
			{plugin.package.author ? <Descriptions.Item label="Author" span={3}>
				{plugin.package.author}
			</Descriptions.Item> : null}
			<Descriptions.Item label="License" span={3}>{plugin.package.license}</Descriptions.Item>
		</Descriptions>
		{plugin.meta.version !== plugin.package.version ? <Alert
			style={{
				marginTop: "1em",
			}}
			message="Version missmatch detected"
			description={
				`The version of the web interface module for this plugin (${plugin.package.version}) `+
				`does not match the version running on the master server (${plugin.meta.version}), `+
				"spurious errors may occur. This usually happens when the plugin is updated but the "+
				"master server has not been restarted yet, but may also be due to an outdated build."
			}
			type="warning"
			showIcon
		/> : null}
	</PageLayout>;
}
