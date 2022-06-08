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

async function loadPlugins() {
	let response = await fetch(`${webRoot}api/plugins`);
	let pluginList;
	if (response.ok) {
		pluginList = await response.json();

	} else {
		logger.error("Failed to get plugin data, running without plugins");
		pluginList = [];
	}

	let plugins = new Map();
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
			let pluginPackage = (await container.get("./package.json"))();

			let WebPluginClass = libPlugin.BaseWebPlugin;
			if (meta.enabled && pluginInfo.webEntrypoint) {
				let webModule = (await container.get(pluginInfo.webEntrypoint))();
				if (!webModule.WebPlugin) {
					throw new Error("Plugin webEntrypoint does not export WebPlugin class");
				}
				WebPluginClass = webModule.WebPlugin;
			}

			let plugin = new WebPluginClass(container, pluginPackage, pluginInfo, logger);
			await plugin.init();
			plugins.set(pluginInfo.name, plugin);

		} catch (err) {
			if (err.message) {
				meta.web.error = err.message;
			}
			logger.error(`Failed to load plugin ${meta.name}`);
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
	let plugins = await loadPlugins();
	let pluginInfos = [...plugins.values()].map(p => p.info);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let wsUrl = new URL(window.webRoot, document.location);
	wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

	let controlConnector = new ControlConnector(wsUrl, 120);
	let control = new Control(controlConnector, plugins);

	ReactDOM.render(<App control={control}/>, document.getElementById("root"));
}
