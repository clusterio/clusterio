import "./index.css";

import React from "react";
import { createRoot } from "react-dom/client";

import * as lib from "@clusterio/lib";

import App from "./components/App";
import BaseWebPlugin from "./BaseWebPlugin";
import { Control, ControlConnector } from "./util/websocket";

const { ConsoleTransport, WebConsoleFormat, logger } = lib;

async function loadScript(url: string) {
	let script = document.createElement("script");
	script.src = url;
	script.type = "text/javascript";
	script.async = true;

	let result = new Promise((resolve, reject) => {
		script.onload = resolve;
		script.onerror = reject;
	});

	document.head.appendChild(script);
	return result;
}

async function loadPluginInfos(): Promise<lib.PluginWebpackEnvInfo[]> {
	let response = await fetch(`${window.webRoot}api/plugins`);
	let pluginList: lib.PluginWebApi[];
	if (response.ok) {
		pluginList = await response.json();

	} else {
		logger.error("Failed to get plugin data, running without plugins");
		pluginList = [];
	}

	let pluginInfos = [];
	await __webpack_init_sharing__("default");
	for (let meta of pluginList) {
		if (meta.web.error) {
			logger.error(`Failed to load plugin ${meta.name}: ${meta.web.error}`);
			continue;
		}
		try {
			await loadScript(`${window.webRoot}${meta.web.main}`);
			let container: any = (window as { [key: string]: any })[`plugin_${meta.name}`];
			if (!container) {
				throw new Error(`Plugin did not expose its container via plugin_${meta.name}`);
			}
			await container.init(__webpack_share_scopes__.default);
			let pluginInfo = (await container.get("./info"))().default;
			pluginInfo.container = container;
			pluginInfo.package = (await container.get("./package.json"))();
			pluginInfo.enabled = meta.enabled;
			pluginInfos.push(pluginInfo);

		} catch (err: any) {
			logger.error(`Failed to load plugin info for ${meta.name}`);
			if (err.stack) {
				logger.error(err.stack);
			}
		}
	}
	return pluginInfos;
}

async function loadPlugins(pluginInfos: lib.PluginWebpackEnvInfo[]) {
	let plugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.enabled) {
			continue;
		}
		try {
			let WebPluginClass = BaseWebPlugin;
			if (pluginInfo.webEntrypoint) {
				let webModule = (await pluginInfo.container.get(pluginInfo.webEntrypoint))();
				if (!webModule.WebPlugin) {
					throw new Error("Plugin webEntrypoint does not export WebPlugin class");
				}
				WebPluginClass = webModule.WebPlugin;
			}

			let plugin = new WebPluginClass(pluginInfo.container, pluginInfo.package, pluginInfo, logger);
			await plugin.init();
			plugins.set(pluginInfo.name, plugin);

		} catch (err: any) {
			logger.error(`Failed to load plugin ${pluginInfo.name}`);
			if (err.stack) {
				logger.error(err.stack);
			}
		}
	}
	return plugins;
}

export default async function bootstrap() {
	logger.add(new ConsoleTransport({
		level: "verbose",
		format: new WebConsoleFormat(),
	}));
	let pluginInfos = await loadPluginInfos();
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginConfigGroups(pluginInfos);
	lib.finalizeConfigs();
	let plugins = await loadPlugins(pluginInfos);

	let wsUrl = new URL(window.webRoot, document.location.href);
	let controlConnector = new ControlConnector(wsUrl.href, 120, undefined);
	let control = new Control(controlConnector, plugins);

	const root = createRoot(document.getElementById("root") as HTMLDivElement);
	root.render(<App control={control}/>);
}
