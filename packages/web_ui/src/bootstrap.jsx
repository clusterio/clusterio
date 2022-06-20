import "./index.css";

import React from "react";
import ReactDOM from "react-dom";

import { libConfig, libLogging, libPlugin } from "@clusterio/lib";
const { ConsoleTransport, WebConsoleFormat, logger } = libLogging;

import App from "./components/App";
import { Control, ControlConnector } from "./util/websocket";


async function loadScript(url) {
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

async function loadPluginInfos() {
	let response = await fetch(`${webRoot}api/plugins`);
	let pluginList;
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
			await loadScript(`${webRoot}${meta.web.main}`);
			let container = window[`plugin_${meta.name}`];
			if (!container) {
				throw new Error(`Plugin did not expose its container via plugin_${meta.name}`);
			}
			await container.init(__webpack_share_scopes__.default);
			let pluginInfo = (await container.get("./info"))();
			pluginInfo.container = container;
			pluginInfo.package = (await container.get("./package.json"))();
			pluginInfo.enabled = meta.enabled;
			pluginInfos.push(pluginInfo);

		} catch (err) {
			logger.error(`Failed to load plugin info for ${meta.name}`);
			if (err.stack) {
				logger.error(err.stack);
			}
		}
	}
	return pluginInfos;
}

async function loadPlugins(pluginInfos) {
	let plugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.enabled) {
			continue;
		}
		try {
			let WebPluginClass = libPlugin.BaseWebPlugin;
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

		} catch (err) {
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
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();
	let plugins = await loadPlugins(pluginInfos);

	let wsUrl = new URL(window.webRoot, document.location);
	wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

	let controlConnector = new ControlConnector(wsUrl, 120);
	let control = new Control(controlConnector, plugins);

	ReactDOM.render(<App control={control}/>, document.getElementById("root"));
}
