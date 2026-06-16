import "./style.css";

import React from "react";
import { createRoot } from "react-dom/client";

import * as lib from "@clusterio/lib";

import App from "./components/App";
import InputRole from "./components/InputRole";
import InputModPack from "./components/InputModPack";
import { InputTargetVersion, InputPartialVersion, InputFullVersion } from "./components/InputVersion";
import { Control, ControlConnector } from "./util/websocket";
import BaseWebPlugin, * as WebPlugin from "./BaseWebPlugin";

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
	let response = await fetch(`${webRoot}api/plugins`);
	let pluginList: lib.PluginWebApi[];
	if (response.ok) {
		pluginList = await response.json();

	} else {
		logger.error("Failed to get plugin data, running without plugins");
		pluginList = [];
	}

	let pluginInfos: lib.PluginWebpackEnvInfo[] = [];
	await __webpack_init_sharing__("default");
	for (let meta of pluginList) {
		if (meta.web.error) {
			logger.error(`Failed to load plugin ${meta.name}: ${meta.web.error}`);
			continue;
		}
		try {
			await loadScript(`${webRoot}${meta.web.main}`);
			let container: any = (window as { [key: string]: any })[`plugin_${meta.name}`];
			if (!container) {
				throw new Error(`Plugin did not expose its container via plugin_${meta.name}`);
			}
			await container.init(__webpack_share_scopes__.default);
			let pluginInfo = (await container.get("./"))().plugin;
			pluginInfo.container = container;
			pluginInfo.package = (await container.get("./package.json"))();
			pluginInfo.enabled = meta.enabled;
			pluginInfos.push(pluginInfo);

		} catch (err: any) {
			pluginInfos.push({
				name: meta.name,
				title: meta.name,
				enabled: false,
				error: err.message,
			});
			logger.error(`Failed to load plugin info for ${meta.name}`);
			if (err.stack) {
				logger.error(err.stack);
			}
		}
	}
	return pluginInfos;
}

async function loadPlugins(pluginInfos: lib.PluginWebpackEnvInfo[], control: Control) {
	let plugins = new Map<string, BaseWebPlugin>();
	for (let pluginInfo of pluginInfos) {
		if (!pluginInfo.enabled) {
			continue;
		}
		try {
			let WebPluginClass = BaseWebPlugin;
			if (pluginInfo.webEntrypoint) {
				let webModule = (await pluginInfo.container.get(pluginInfo.webEntrypoint))();
				if (!webModule.WebPlugin) {
					pluginInfo.error = "Plugin webEntrypoint does not export WebPlugin class";
					throw new Error(pluginInfo.error);
				}
				WebPluginClass = webModule.WebPlugin;
			}

			let plugin = new WebPluginClass(pluginInfo.container, pluginInfo.package, pluginInfo, control, logger);
			await plugin.init();
			plugins.set(pluginInfo.name, plugin);

		} catch (err: any) {
			pluginInfo.error = `Error loading plugin: ${err.message}`;
			logger.error(`Failed to load plugin ${pluginInfo.name}`);
			if (err.stack) {
				logger.error(err.stack);
			}
		}
	}
	return plugins;
}

function mergeWithWarning<V>(
	entries: Iterable<[string, Iterable<V>]>,
	getKey: (item: V) => string,
	label: string
): V[] {
	const map = new Map<string, V>();
	const sources = new Map<string, string>();

	for (const [source, items] of entries) {
		for (const item of items) {
			const key = getKey(item);
			if (sources.has(key)) {
				lib.logger.warn(
					`Plugin ${source} is redefining ${label} "${key}" previously defined by ${sources.get(key)}`
				);
			}

			sources.set(key, source);
			map.set(key, item);
		}
	}

	return [...map.values()];
}

async function inputComponentsFromHooks(control: Control) {
	const result = await control.hooks.inputComponents.collectEntries();

	result.unshift(["core", {
		"full_version": InputFullVersion,
		"partial_version": InputPartialVersion,
		"target_version": InputTargetVersion,
		"mod_pack": InputModPack,
		"role": InputRole,
	}]);

	const iterable = result.map(
		v => [v[0], Object.entries(v[1])] as [string, Iterable<[string, WebPlugin.InputComponent]>]
	);

	return new Map(mergeWithWarning(iterable, ([key]) => key, "input component"));
}

async function extensionComponentsFromHooks(control: Control) {
	const extensionComponents = {} as WebPlugin.ExtensionComponents;

	const result = await control.hooks.extensionComponents.collectEntries();
	for (const [source, record] of result) {
		for (const [slot, Component] of Object.entries(record) as [
			WebPlugin.PluginExtensionSlot, React.ComponentType,
		][]) {
			if (!extensionComponents[slot]) {
				extensionComponents[slot] = new Map();
			}
			extensionComponents[slot].set(source, Component as any);
		}
	}

	return extensionComponents;
}

async function loginFormsFromHooks(control: Control) {
	const results = await control.hooks.loginForms.collectEntries();
	return mergeWithWarning<WebPlugin.PluginLoginForm>(results, item => item.name, "login form");
}

async function pagesFromHooks(control: Control) {
	const results = await control.hooks.pages.collectEntries();
	return mergeWithWarning<WebPlugin.PluginPage>(results, item => item.path, "page");
}

export default async function bootstrap() {
	logger.add(new ConsoleTransport({
		level: "verbose",
		format: new WebConsoleFormat(),
	}));
	const pluginInfos = await loadPluginInfos();
	const pluginInfoEntries = pluginInfos.map(p => [p.name, p] as const);
	lib.registerPluginMessages(pluginInfos);
	lib.addPluginConfigFields(pluginInfos);

	let wsUrl = new URL(webRoot, document.location.href);
	let controlConnector = new ControlConnector(wsUrl.href, 120);
	let control = new Control(controlConnector, new Map(pluginInfoEntries));
	control.plugins = await loadPlugins(pluginInfos, control);
	control.loadedPlugins = new Map(pluginInfoEntries.filter(info => control.plugins.has(info[0])));
	control.inputComponents = await inputComponentsFromHooks(control);
	control.extensionComponents = await extensionComponentsFromHooks(control);
	control.loginForms = await loginFormsFromHooks(control);
	control.pages = await pagesFromHooks(control);

	const root = createRoot(document.getElementById("root") as HTMLDivElement);
	root.render(<App control={control}/>);
}
