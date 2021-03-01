import "./index.css";

import React from "react";
import ReactDOM from "react-dom";

import libConfig from "@clusterio/lib/config";
import { ConsoleTransport, WebConsoleFormat, logger } from "@clusterio/lib/logging";

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

	let plugins = [];
	await __webpack_init_sharing__("default");
	for (let meta of pluginList) {
		try {
			await loadScript(`${webRoot}plugin/${meta.name}/remoteEntry.js`);
			let container = window[`plugin_${meta.name}`];
			await container.init(__webpack_share_scopes__.default);
			let pluginInfo = (await container.get("./info"))();
			let pluginPackage = (await container.get("./package.json"))();
			plugins.push({
				meta,
				info: pluginInfo,
				package: pluginPackage,
				container,
			});

		} catch (err) {
			logger.error(`Failed to load plugin info for ${meta.name}`);
			plugins.push({
				meta,
			});
		}
	}
	return plugins;
}

async function load() {
	logger.add(new ConsoleTransport({
		level: "verbose",
		format: new WebConsoleFormat(),
	}));
	let plugins = await loadPlugins();
	libConfig.registerPluginConfigGroups(plugins.filter(p => p.info).map(p => p.info));
	libConfig.finalizeConfigs();

	let wsUrl = new URL(window.webRoot, document.location);
	wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

	let controlConnector = new ControlConnector(wsUrl, 10);
	let control = new Control(controlConnector, []);

	ReactDOM.render(<App control={control} plugins={plugins}/>, document.getElementById("root"));
}

load().catch((err) => logger.fatal(err.stack));
