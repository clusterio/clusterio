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
});
