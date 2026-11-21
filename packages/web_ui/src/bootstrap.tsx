import "./style.css";

import React from "react";
import { createRoot } from "react-dom/client";

import * as lib from "@clusterio/lib";

import App from "./components/App";
import InputRole from "./components/InputRole";
import InputModPack from "./components/InputModPack";
import { InputInstanceTemplate } from "./components/InputInstance";
import { InputTargetVersion, InputPartialVersion, InputFullVersion } from "./components/InputVersion";
import { Control, ControlConnector } from "./util/websocket";
import { loadedPluginSetKey } from "./util/pluginSet";
import * as WebPlugin from "./BaseWebPlugin";
import { pages } from "./pages";

const { ConsoleTransport, WebConsoleFormat, logger } = lib;

async function loadPluginInfos(): Promise<[lib.PluginWebEnvInfo[], string]> {
	let response = await fetch(`${webRoot}api/plugins`);
	let pluginList: lib.PluginWebApi[];
	if (response.ok) {
		pluginList = await response.json();

	} else {
		logger.error("Failed to get plugin data, running without plugins");
		pluginList = [];
	}
	let pluginSetKey = loadedPluginSetKey(pluginList);

	let pluginInfos: lib.PluginWebEnvInfo[] = [];
	for (let meta of pluginList) {
		if (meta.web.error) {
			logger.error(`Failed to load plugin ${meta.name}: ${meta.web.error}`);
			continue;
		}
		if (!meta.web.main) {
			continue;
		}
		try {
			let container = await import(/* @vite-ignore */ `${staticRoot}${meta.web.main}`);
			if (typeof container.get !== "function") {
				throw new Error("Plugin web bundle does not export get");
			}
			let pluginInfo = (await container.get("./")).plugin;
			pluginInfo.container = container;
			pluginInfo.package = (await container.get("./package.json")).default;
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
	return [pluginInfos, pluginSetKey];
}

async function loadPlugins(
	pluginInfos: lib.PluginWebEnvInfo[],
	control: Control
) {
	const { loaded, failed } = await lib.PluginLoader.load({
		type: "web",
		context: (pluginInfo: lib.PluginWebEnvInfo) => ({
			control,
			container: pluginInfo.container,
			package: pluginInfo.package,
		}),
		logger,
		installed: pluginInfos,
		load: pluginInfos.filter(pluginInfo => pluginInfo.enabled && pluginInfo.webEntrypoint),
		exportName: "WebPlugin",
		baseClass: WebPlugin.BaseWebPlugin,
		continueOnError: true,
	});

	for (const [pluginInfo, err] of failed) {
		const cause = err instanceof lib.PluginError ? err.original : err;
		pluginInfo.error = `Error loading plugin: ${cause.message}`;
		logger.error(`Failed to load plugin ${pluginInfo.name}`);
		if (cause.stack) {
			logger.error(cause.stack);
		}
	}

	const plugins = new Map<string, WebPlugin.BaseWebPlugin>();
	for (const [pluginInfo, api] of loaded) {
		if (api instanceof WebPlugin.BaseWebPlugin) {
			plugins.set(pluginInfo.name, api);
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
		"instance_template": InputInstanceTemplate,
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
	results.unshift(["core", pages]);
	return mergeWithWarning<WebPlugin.PluginPage>(results, item => item.path, "page");
}

export default async function bootstrap() {
	logger.add(new ConsoleTransport({
		level: "verbose",
		format: new WebConsoleFormat(),
	}));
	const [pluginInfos, pluginSetKey] = await loadPluginInfos();
	const pluginInfoEntries = pluginInfos.map(p => [p.name, p] as const);
	lib.registerPluginMessages(pluginInfos);
	lib.registerPluginPermissions(pluginInfos);
	lib.addPluginConfigFields(pluginInfos);

	let wsUrl = new URL(webRoot, document.location.href);
	let controlConnector = new ControlConnector(wsUrl.href, 120);
	let control = new Control(controlConnector, new Map(pluginInfoEntries), pluginSetKey);
	control.plugins = await loadPlugins(pluginInfos, control);
	control.loadedPlugins = new Map(pluginInfoEntries.filter(
		([_, info]) => info.enabled && info.webEntrypoint && !info.error
	));

	control.inputComponents = await inputComponentsFromHooks(control);
	control.extensionComponents = await extensionComponentsFromHooks(control);
	control.loginForms = await loginFormsFromHooks(control);
	control.pages = await pagesFromHooks(control);

	const root = createRoot(document.getElementById("root") as HTMLDivElement);
	root.render(<App control={control}/>);
}
