import React, { useEffect, useContext, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Descriptions, Spin } from "antd";

import * as lib from "@clusterio/lib";
import type { PluginWebApi } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PageHeader from "./PageHeader";
import SectionHeader from "./SectionHeader";
import notify from "../util/notify";
import { usePluginInstaller } from "./PluginInstall";
import { PluginMachinesTable, PluginUpdateButton, useLatestVersions, useMachinePlugins } from "./PluginClusterStatus";
import { PluginStatus, computePluginStatuses, pluginStatusKey } from "../util/plugin_status";

type PluginMachinesProps = {
	status: PluginStatus,
	title: string,
	refresh: (addresses: lib.AddressShorthand[]) => void,
};

function PluginMachines(props: PluginMachinesProps) {
	const installer = usePluginInstaller(props.refresh);
	const { npmPackage } = props.status;
	const latestVersions = useLatestVersions(npmPackage ? [npmPackage] : []);
	const latest = npmPackage ? latestVersions[npmPackage] : undefined;

	return <>
		<Descriptions bordered size="small" style={{ marginTop: "1em" }}>
			<Descriptions.Item label="Package" span={npmPackage ? 1 : 3}>
				{npmPackage ?? "Not published to npm"}
			</Descriptions.Item>
			{npmPackage && <Descriptions.Item label="Latest version" span={2}>
				{latest ?? "Unknown"}
			</Descriptions.Item>}
		</Descriptions>
		<SectionHeader
			title="Machines"
			extra={<PluginUpdateButton
				status={props.status} title={props.title} latest={latest} installer={installer}
			/>}
		/>
		<PluginMachinesTable status={props.status} latest={latest} installer={installer} />
	</>;
}

type ControllerPluginProps = {
	pluginMeta: PluginWebApi,
	pluginInfo?: lib.PluginWebpackEnvInfo,
	loadedPlugin?: lib.PluginWebpackEnvInfo,
	title: string,
};

/** What the controller and web UI have loaded of the plugin */
function ControllerPlugin(props: ControllerPluginProps) {
	const { pluginMeta, pluginInfo, loadedPlugin } = props;
	const pluginError = pluginMeta.web.error ?? pluginInfo?.error;
	const hasWebModule = Boolean(pluginMeta.web.main || pluginMeta.web.error);
	if (!loadedPlugin) {
		return <>
			<Descriptions bordered size="small" title={props.title}>
				<Descriptions.Item label="Version">{pluginMeta.version}</Descriptions.Item>
				<Descriptions.Item label="Loaded in Web UI" span={2}>
					{hasWebModule ? "No" : "No web module"}
				</Descriptions.Item>
				<Descriptions.Item label="Loaded on controller">{pluginMeta.loaded ? "Yes" : "No"}</Descriptions.Item>
				<Descriptions.Item label="Enabled on controller" span={2}>
					{pluginMeta.enabled ? "Yes" : "No"}
				</Descriptions.Item>
			</Descriptions>
			{pluginError && <Alert
				style={{
					marginTop: "1em",
				}}
				message={pluginError}
				description={
					"The web interface was unable to load the webpack module for this plugin. This is "+
					"usually due to an incorrect or missing webpack build for the plugin. Due to the "+
					"module not being loaded, the configs and web controls defined by this plugin may "+
					"not be available in the web interface."
				}
				type="error"
				showIcon
			/>}
		</>;
	}

	const homepageUrl = lib.safeExternalUrl(loadedPlugin.package.homepage);
	return <>
		<Descriptions bordered size="small" title={props.title}>
			<Descriptions.Item label="Version">{pluginMeta.version}</Descriptions.Item>
			<Descriptions.Item label="Loaded in Web UI" span={2}>Yes</Descriptions.Item>
			<Descriptions.Item label="Loaded on controller">{pluginMeta.loaded ? "Yes" : "No"}</Descriptions.Item>
			<Descriptions.Item label="Enabled on controller" span={2}>
				{pluginMeta.enabled ? "Yes" : "No"}
			</Descriptions.Item>
			<Descriptions.Item label="Description" span={3}>{loadedPlugin.description}</Descriptions.Item>
			{loadedPlugin.package.homepage ? <Descriptions.Item label="Homepage" span={3}>
				{homepageUrl
					? <a href={homepageUrl}>{loadedPlugin.package.homepage}</a>
					: loadedPlugin.package.homepage}
			</Descriptions.Item> : null}
			{loadedPlugin.package.author ? <Descriptions.Item label="Author" span={3}>
				{loadedPlugin.package.author}
			</Descriptions.Item> : null}
			<Descriptions.Item label="License" span={3}>{loadedPlugin.package.license}</Descriptions.Item>
		</Descriptions>
		{pluginMeta.version !== loadedPlugin.package.version ? <Alert
			style={{
				marginTop: "1em",
			}}
			message="Version missmatch detected"
			description={
				`The version of the web interface module for this plugin (${loadedPlugin.package.version}) `+
				`does not match the version running on the controller (${pluginMeta.version}), `+
				"spurious errors may occur. This usually happens when the plugin is updated but the "+
				"controller has not been restarted yet, but may also be due to an outdated build."
			}
			type="warning"
			showIcon
		/> : null}
	</>;
}

export default function PluginViewPage() {
	let params = useParams();
	const control = useContext(ControlContext);
	let [pluginList, setPluginList] = useState<PluginWebApi[]>();
	let pluginName = String(params.name);
	const { machines, unknown, refresh } = useMachinePlugins();

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

	const pluginMeta = pluginList?.find(p => p.name === pluginName);
	// Plugins the controller hasn't loaded are linked to by their npm package or name on the hosts
	const status = machines
		? computePluginStatuses(machines, unknown).get(pluginMeta ? pluginStatusKey(pluginMeta) : pluginName)
		: undefined;
	const pluginInfo = control.pluginInfos.get(pluginName);
	const pluginTitle = pluginInfo?.title ?? status?.title ?? pluginName;
	let nav = [{ name: "Plugins", path: "/plugins" }, { name: pluginTitle }];
	if (!pluginList || (!pluginMeta && !machines)) {
		return <PageLayout nav={nav}>
			<Descriptions bordered size="small" title={pluginTitle} />
			<Spin size="large" />
		</PageLayout>;
	}

	if (!pluginMeta && !status) {
		return <PageLayout nav={nav}>
			<PageHeader title="Plugin not found" />
			<p>Plugin with name {pluginName} was not found on the controller or any host.</p>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		{pluginMeta
			? <ControllerPlugin
				pluginMeta={pluginMeta}
				pluginInfo={pluginInfo}
				loadedPlugin={control.loadedPlugins.get(pluginName)}
				title={pluginTitle}
			/>
			: <Descriptions bordered size="small" title={pluginTitle}>
				<Descriptions.Item label="Loaded on controller">No</Descriptions.Item>
			</Descriptions>}
		{status && <PluginMachines status={status} title={pluginTitle} refresh={refresh} />}
	</PageLayout>;
}
