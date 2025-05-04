"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Host } = require("@clusterio/host");

describe("messages/controller", function() {
	/** @type {Host} */
	let host;

	beforeEach(function() {
		const hostConfig = new lib.HostConfig("host");
		const hostConnector = new lib.VirtualConnector(
			lib.Address.fromShorthand({ hostId: 1 }),
			lib.Address.fromShorthand("controller"),
		);
		host = new Host(hostConnector, "", hostConfig, undefined, []);
	});

	describe("HostUpdateRequest", function() {
		it("runs", async function() {
			host.config.set("host.allow_remote_updates", true);
			await host.handleHostUpdateRequest(new lib.HostUpdateRequest());
		});
		it("rejects if updates are disabled", async function() {
			host.config.set("host.allow_remote_updates", false);
			assert.rejects(
				host.handleHostUpdateRequest(new lib.HostUpdateRequest()),
				"Remote updates are disabled on this machine"
			);
		});
	});
});
