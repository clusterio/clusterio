import "./index.css";

import React from "react";
import ReactDOM from "react-dom";

import libConfig from "@clusterio/lib/config";

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
		console.log("Failed to get plugin data, running without plugins");
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
			console.log(`Failed to load plugin info for ${plugin.name}`);
			console.log(err);
		}
	}
	return pluginInfos;
}

async function load() {
	let pluginInfos = await loadPluginInfos();
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	let wsUrl = new URL(window.webRoot, document.location);
	wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

	let controlConnector = new ControlConnector(wsUrl, 10, localStorage.getItem("master_token"));
	// XXX come up with a better way of sharing this
	window.control = new Control(controlConnector, []);
	try {
		await controlConnector.connect();
	} catch (err) {
		// XXX: What now?
		console.log(err);
	}

	ReactDOM.render(<App />, document.getElementById("root"));
}

load().catch(console.log);
