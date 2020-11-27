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
	for (let plugin of pluginList) {
		try {
			await loadScript(`${webRoot}plugin/${plugin.name}/remoteEntry.js`);
			let container = window[`plugin_${plugin.name}`];
			await container.init(__webpack_share_scopes__.default);
			let info = (await container.get("./info"))();
			info.container = container;
			pluginInfos.push(info);

		} catch (err) {
			logger.error(`Failed to load plugin info for ${plugin.name}`);
		}
	}
	return pluginInfos;
}

async function load() {
	logger.add(new ConsoleTransport({
		level: "verbose",
		format: new WebConsoleFormat(),
	}));
	let pluginInfos = await loadPluginInfos();
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let wsUrl = new URL(window.webRoot, document.location);
	wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

	let controlConnector = new ControlConnector(wsUrl, 10);
	let control = new Control(controlConnector, []);

	ReactDOM.render(<App control={control}/>, document.getElementById("root"));
}

load().catch((err) => logger.fatal(err));
