import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import { PluginDetails } from "@clusterio/lib";
import SiteLayout from "../../packages/web_ui/src/components/SiteLayout.tsx";
import PluginsPage from "../../packages/web_ui/src/components/PluginsPage.tsx";
import ControlContext from "../../packages/web_ui/src/components/ControlContext.tsx";
import "../../packages/web_ui/src/style.css";

const specs = [
	["awf_oarc", "awf_oarc", "0.2.16", "0.3.1"],
	["auto_restart", "ExpGaming - Auto Restart", "7.0.5", "7.0.5"],
	["global_chat", "Global Chat", "2.0.0", "2.1.0"],
	["research_sync", "Research Sync", "2.1.0", "2.1.0"],
];
const plugins = specs.map(([name, title, version, latest]) => new PluginDetails(
	name, title, version, "loaded", undefined, `@fixture/${name}`,
	name === "awf_oarc" ? latest : version, `@fixture/${name}`,
));
const hostPlugins = plugins.map(plugin => plugin.name === "auto_restart"
	? new PluginDetails(plugin.name, plugin.title, plugin.version, "noEntrypoint", undefined,
		plugin.npmPackage, plugin.version, plugin.dependencyName) : plugin);
const store = entries => {
	const snapshot = [new Map(entries), true, null];
	return { subscribe: () => () => {}, getSnapshot: () => snapshot };
};
const meta = plugins.map(p => ({ name: p.name, version: p.version, npmPackage: p.npmPackage,
	enabled: true, web: p.name === "awf_oarc" ? { error: "Fixture: web module could not load" } : {} }));
const originalFetch = window.fetch;
window.fetch = (url, ...rest) => String(url).endsWith("api/plugins")
	? Promise.resolve(new Response(JSON.stringify(meta))) : originalFetch(url, ...rest);
const permissions = ["core.plugin.list", "core.plugin.search", "core.plugin.update", "core.plugin.install",
	"core.controller.restart", "core.host.restart"];
const control = {
	accountName: "Cooldude2606", accountRoles: [{ permissions }],
	onAccountUpdate() {}, offAccountUpdate() {}, connector: {},
	plugins: new Map(),
	pluginInfos: new Map(specs.map(([name, title]) => [name, { name, title }])),
	hosts: store([[1, { id: 1, name: "Host 1", connected: true }]]),
	systems: store([["controller", { plugins, canRestart: true }], [1, { plugins: hostPlugins, canRestart: true }]]),
	instances: store([]), users: store([]),
	pages: [
		...["Controller", "Hosts", "Instances", "Users"].map(title => ({ path: `/${title.toLowerCase()}`,
			sidebarName: title, content: <div>{title}</div> })),
		{ path: "/plugins", sidebarName: "Plugins", content: <PluginsPage /> },
		{ path: "/plugins/:name/view", content: <div>Plugin navigation target</div> },
	],
	async send(request) {
		if (request.constructor.name === "PluginLatestVersionsRequest") {
			return { versions: Object.fromEntries(specs.map(([name, , , latest]) => [`@fixture/${name}`, latest])) };
		}
		throw new Error(`Unexpected fixture request: ${request.constructor.name}`);
	},
	async sendTo(address, request) {
		if (request.constructor.name === "PluginListRequest") { return address === "controller" ? plugins : hostPlugins; }
		throw new Error(`Unexpected fixture request: ${request.constructor.name}`);
	},
};
window.fixtureControl = control;
createRoot(document.getElementById("root")).render(<ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
	<ControlContext.Provider value={control}><BrowserRouter><SiteLayout /></BrowserRouter></ControlContext.Provider>
</ConfigProvider>);
