"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Controller, ControlConnection } = require("@clusterio/controller");
const { Host } = require("@clusterio/host");

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
		host = new Host(hostConnector, hostConfig, undefined, []);
	});

	describe("PluginDetails", function() {
		it("has round trip json serialisation", function() {
			const pluginDetails = new lib.PluginDetails(
				"Name", "Title", "Version", true, true,
				"Description", "Npm Package",
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

			controller.plugins.set("Name", {});
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

			host.plugins.set("Name", {});
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
});
