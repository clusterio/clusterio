import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

import { Controller, ControlConnection } from "@clusterio/controller";
import { Host } from "@clusterio/host";

import "../setup_logging.js";

describe("messages/plugin", function() {
	/** @type {Host} */
	let host;
	/** @type {Controller} */
	let controller;
	/** @type {ControlConnection} */
	let controlConnection;

	beforeEach(function() {
		const controllerConfig = new lib.ControllerConfig("controller");
		const connection = new lib.VirtualConnector(
			lib.Address.fromShorthand("controller"),
			lib.Address.fromShorthand({ controlId: 1 }),
		);
		controller = new Controller(lib.logger, [], controllerConfig);
		const user = controller.users.getOrCreateUser("test");
		controlConnection = new ControlConnection({ version: "2.0.0" }, connection, controller, user, 1);

		const hostConfig = new lib.HostConfig("host");
		const hostConnector = new lib.VirtualConnector(
			lib.Address.fromShorthand({ hostId: 1 }),
			lib.Address.fromShorthand("controller"),
		);
		host = new Host(hostConnector, hostConfig, []);
	});

	describe("PluginDetails", function() {
		it("has round trip json serialisation", function() {
			const pluginDetails = new lib.PluginDetails(
				"Name", "Title", "Version", true, true,
				"Description", "Npm Package", "Installed Version", true, true,
			);

			const json = JSON.stringify(pluginDetails);
			const reconstructed = lib.PluginDetails.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, pluginDetails);
		});
		it("can be created from NodeEnvInfo interface", function() {
			const pluginDetails = lib.PluginDetails.fromNodeEnvInfo({
				name: "Name", title: "Title", version: "Version",
				description: "Description", npmPackage: "Npm Package",
			}, true, true);
			assert.deepEqual(pluginDetails, new lib.PluginDetails(
				"Name", "Title", "Version", true, true,
				"Description", "Npm Package",
			));
		});
	});

	describe("PluginListRequest", function() {
		before(function() {
			lib.ControllerConfig.fieldDefinitions["Name.load_plugin"] = {
				type: "boolean",
				initialValue: true,
			};
			lib.HostConfig.fieldDefinitions["Name.load_plugin"] = {
				type: "boolean",
				initialValue: true,
			};
		});
		after(function() {
			delete lib.ControllerConfig.fieldDefinitions["Name.load_plugin"];
			delete lib.HostConfig.fieldDefinitions["Name.load_plugin"];
		});
		it("returns correct info from the controller", async function() {
			controller.pluginInfos = [{
				name: "Name", title: "Title", version: "Version",
				description: "Description", npmPackage: "Npm Package",
			}];

			controller.loadedPlugins.add(controller.pluginInfos[0]);
			controller.config.set("Name.load_plugin", true);

			const response = await controlConnection.handlePluginListRequest(new lib.PluginListRequest());
			assert.deepEqual(response, [new lib.PluginDetails(
				"Name", "Title", "Version", true, true,
				"Description", "Npm Package",
			)]);
		});
		it("returns correct info from a host", async function() {
			host.pluginInfos = [{
				name: "Name", title: "Title", version: "Version",
				description: "Description", npmPackage: "Npm Package",
			}];

			host.loadedPlugins.add(host.pluginInfos[0]);
			host.config.set("Name.load_plugin", true);

			const response = await host.handlePluginListRequest(new lib.PluginListRequest());
			assert.deepEqual(response, [new lib.PluginDetails(
				"Name", "Title", "Version", true, true,
				"Description", "Npm Package",
			)]);
		});
	});

	describe("PluginUpdateRequest", function() {
		it("has round trip json serialisation", function() {
			const request = new lib.PluginUpdateRequest("foo");
			const json = JSON.stringify(request);
			const reconstructed = lib.PluginUpdateRequest.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, request);
		});
		it("runs on the controller", async function() {
			controller.pluginInfos = [{ npmPackage: "foo" }];
			controller.config.set("controller.allow_plugin_updates", true);
			await controlConnection.handlePluginUpdateRequest(new lib.PluginUpdateRequest("foo"));
		});
		it("rejects if updates are disabled on the controller", async function() {
			controller.config.set("controller.allow_plugin_updates", false);
			await assert.rejects(
				controlConnection.handlePluginUpdateRequest(new lib.PluginUpdateRequest("foo")),
				/Plugin updates are disabled on this machine/
			);
		});
		it("runs on a host", async function() {
			host.pluginInfos = [{ npmPackage: "foo" }];
			host.config.set("host.allow_plugin_updates", true);
			await host.handlePluginUpdateRequest(new lib.PluginUpdateRequest("foo"));
		});
		it("rejects if updates are disabled on the host", async function() {
			host.config.set("host.allow_plugin_updates", false);
			await assert.rejects(
				host.handlePluginUpdateRequest(new lib.PluginUpdateRequest("foo")),
				/Plugin updates are disabled on this machine/
			);
		});
	});

	describe("PluginSearchRequest", function() {
		const _fetch = global.fetch;
		after(function() {
			global.fetch = _fetch;
		});

		it("has round trip json serialisation", function() {
			const request = new lib.PluginSearchRequest("foo", 2, 10);
			const json = JSON.stringify(request);
			const reconstructed = lib.PluginSearchRequest.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, request);
		});
		it("has round trip json serialisation of the response", function() {
			const response = new lib.PluginSearchRequest.Response(1, [
				new lib.PluginSearchResult("foo", "1.0.0", "Foo", "bar", "date", "home", "repo", "npm"),
			]);
			const json = JSON.stringify(response);
			const reconstructed = lib.PluginSearchRequest.Response.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, response);
		});
		it("runs on the controller", async function() {
			global.fetch = function() {
				return { ok: true, json: async () => ({ total: 0, objects: [] }) };
			};
			const response = await controlConnection.handlePluginSearchRequest(new lib.PluginSearchRequest());
			assert.deepEqual(response, new lib.PluginSearchRequest.Response(0, []));
		});
	});

	describe("UpdateAllRequest", function() {
		function checkedPermissions(dst) {
			const permissions = [];
			const user = { checkPermission(permission) { permissions.push(permission); } };
			lib.UpdateAllRequest.permission(user, { dst: lib.Address.fromShorthand(dst) });
			return permissions;
		}
		it("requires controller and plugin update permissions on the controller", function() {
			assert.deepEqual(checkedPermissions("controller"), ["core.controller.update", "core.plugin.update"]);
		});
		it("requires host and plugin update permissions on a host", function() {
			assert.deepEqual(checkedPermissions({ hostId: 1 }), ["core.host.update", "core.plugin.update"]);
		});
		it("runs on the controller", async function() {
			controller.pluginInfos = [{ npmPackage: "foo" }];
			controller.config.set("controller.allow_remote_updates", true);
			controller.config.set("controller.allow_plugin_updates", true);
			await controlConnection.handleUpdateAllRequest(new lib.UpdateAllRequest());
		});
		it("rejects if remote updates are disabled on the controller", async function() {
			controller.config.set("controller.allow_remote_updates", false);
			await assert.rejects(
				controlConnection.handleUpdateAllRequest(new lib.UpdateAllRequest()),
				/Remote updates are disabled on this machine/
			);
		});
		it("rejects if plugin updates are disabled on the controller", async function() {
			controller.config.set("controller.allow_plugin_updates", false);
			await assert.rejects(
				controlConnection.handleUpdateAllRequest(new lib.UpdateAllRequest()),
				/Plugin updates are disabled on this machine/
			);
		});
		it("runs on a host", async function() {
			host.pluginInfos = [{ npmPackage: "foo" }];
			host.config.set("host.allow_remote_updates", true);
			host.config.set("host.allow_plugin_updates", true);
			await host.handleUpdateAllRequest(new lib.UpdateAllRequest());
		});
		it("rejects if remote updates are disabled on the host", async function() {
			host.config.set("host.allow_remote_updates", false);
			await assert.rejects(
				host.handleUpdateAllRequest(new lib.UpdateAllRequest()),
				/Remote updates are disabled on this machine/
			);
		});
		it("rejects if plugin updates are disabled on the host", async function() {
			host.config.set("host.allow_plugin_updates", false);
			await assert.rejects(
				host.handleUpdateAllRequest(new lib.UpdateAllRequest()),
				/Plugin updates are disabled on this machine/
			);
		});
	});

	describe("PluginInstallRequest", function() {
		const _fetch = global.fetch;
		before(function() {
			// This is needed to bypass the npm registry check when installing a plugin
			global.fetch = function() { return { ok: true }; };
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("has round trip json serialisation", function() {
			const request = new lib.PluginInstallRequest("foo");
			const json = JSON.stringify(request);
			const reconstructed = lib.PluginInstallRequest.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, request);
		});
		it("runs on the controller", async function() {
			controller.config.set("controller.allow_plugin_install", true);
			await controlConnection.handlePluginInstallRequest(new lib.PluginInstallRequest("foo"));
		});
		it("rejects if installs are disabled on the controller", async function() {
			controller.config.set("controller.allow_plugin_install", false);
			await assert.rejects(
				controlConnection.handlePluginInstallRequest(new lib.PluginInstallRequest("foo")),
				/Plugin installs are disabled on this machine/
			);
		});
		it("runs on a host", async function() {
			host.config.set("host.allow_plugin_install", true);
			await host.handlePluginInstallRequest(new lib.PluginInstallRequest("foo"));
		});
		it("rejects if installs are disabled on the host", async function() {
			host.config.set("host.allow_plugin_install", false);
			await assert.rejects(
				host.handlePluginInstallRequest(new lib.PluginInstallRequest("foo")),
				/Plugin installs are disabled on this machine/
			);
		});
	});
	describe("PluginLatestVersionsRequest", function() {
		const _fetch = global.fetch;
		before(function() {
			global.fetch = async function() { return { ok: true, json: async () => ({ version: "4.5.6" }) }; };
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("has round trip json serialisation", function() {
			const request = new lib.PluginLatestVersionsRequest(["foo", "@scope/bar"]);
			const reconstructed = lib.PluginLatestVersionsRequest.fromJSON(JSON.parse(JSON.stringify(request)));
			assert.deepEqual(reconstructed, request);
		});
		it("has round trip json serialisation of the response", function() {
			const response = new lib.PluginLatestVersionsRequest.Response({ foo: "1.0.0" });
			const reconstructed = lib.PluginLatestVersionsRequest.Response.fromJSON(
				JSON.parse(JSON.stringify(response))
			);
			assert.deepEqual(reconstructed, response);
		});
		it("runs on the controller", async function() {
			const response = await controlConnection.handlePluginLatestVersionsRequest(
				new lib.PluginLatestVersionsRequest(["latest-message-test"])
			);
			assert.deepEqual(response.versions, { "latest-message-test": "4.5.6" });
		});
	});
});
