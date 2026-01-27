"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Controller, ControlConnection, ControllerUser } = require("@clusterio/controller");

describe("messages/controller", function() {
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
		const user = new ControllerUser(controller.userManager, undefined, "test");
		controlConnection = new ControlConnection({ version: "2.0.0" }, connection, controller, user, 1);
	});

	describe("ControllerUpdateRequest", function() {
		it("runs", async function() {
			controller.config.set("controller.allow_remote_updates", true);
			await controlConnection.handleControllerUpdateRequest(new lib.ControllerUpdateRequest());
		});
		it("rejects if updates are disabled", async function() {
			controller.config.set("controller.allow_remote_updates", false);
			await assert.rejects(
				controlConnection.handleControllerUpdateRequest(new lib.ControllerUpdateRequest()),
				/Remote updates are disabled on this machine/
			);
		});
	});

	describe("External", function() {
		it("runs", async function() {
			let callCount = 0;
			const versions = [
				{ version: "1.2.3", stable: true, headlessUrl: "path/to/download" },
				{ version: "1.2.4", stable: false, headlessUrl: "path/to/download" },
			];

			// Mock the cache to avoid needless fetches
			controller.factorioVersions = new lib.ValueCache(async () => {
				callCount += 1;
				return versions;
			});

			// First call should result in a fetch
			const versions1 = await controlConnection.handleFactorioVersionsRequest(
				new lib.FactorioVersionsRequest()
			);

			assert.deepEqual(versions1, versions);
			assert.equal(callCount, 1);

			// Second call should not fetch due to default maxAgeMs being greater than 0
			const versions2 = await controlConnection.handleFactorioVersionsRequest(
				new lib.FactorioVersionsRequest()
			);

			assert.deepEqual(versions2, versions);
			assert.equal(callCount, 1);

			// Setting maxAgeMs to 0 should result in a new fetch
			const versions3 = await controlConnection.handleFactorioVersionsRequest(
				new lib.FactorioVersionsRequest(0)
			);

			assert.deepEqual(versions3, versions);
			assert.equal(callCount, 2);
		});
	});
});
