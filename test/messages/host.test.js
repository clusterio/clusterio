"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Host } = require("@clusterio/host");
const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

describe("messages/host", function() {
	/** @type {Host} */
	let host;

	beforeEach(function() {
		const hostConfig = new lib.HostConfig("host");
		const hostConnector = new lib.VirtualConnector(
			lib.Address.fromShorthand({ hostId: 1 }),
			lib.Address.fromShorthand("controller"),
		);
		host = new Host(hostConnector, hostConfig, []);
	});

	describe("HostUpdateRequest", function() {
		it("runs", async function() {
			host.config.set("host.allow_remote_updates", true);
			await host.handleHostUpdateRequest(new lib.HostUpdateRequest());
		});
		it("rejects if updates are disabled", async function() {
			host.config.set("host.allow_remote_updates", false);
			await assert.rejects(
				host.handleHostUpdateRequest(new lib.HostUpdateRequest()),
				/Remote updates are disabled on this machine/
			);
		});
	});

	describe("HostConfigGetRequest", function() {
		it("runs", async function() {
			const config = await host.handleHostConfigGetRequest(new lib.HostConfigGetRequest());
			assert.deepEqual(config, host.config.toRemote("control"));
		});
	});

	describe("HostConfigSetFieldRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.HostConfigSetFieldRequest, testMatrix(
				["controller.name", "invalid"], // field
				["Foo Bar", "true", "5", "{}"], // value
			));
		});
		it("runs", async function() {
			await host.handleHostConfigSetFieldRequest(new lib.HostConfigSetFieldRequest("host.name", "Foo Bar"));
			assert.equal(host.config.get("host.name"), "Foo Bar");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				host.handleHostConfigSetFieldRequest(new lib.HostConfigSetFieldRequest("invalid", "Foo Bar")),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				host.handleHostConfigSetFieldRequest(new lib.HostConfigSetFieldRequest("host.version", "2.0.0")),
				/Field 'host.version' is not accessible from control/
			);
		});
		it("rejects setting 'host.id'", async function() {
			await assert.rejects(
				host.handleHostConfigSetFieldRequest(new lib.HostConfigSetFieldRequest("host.id", 5)),
				/Setting 'host.id' while host is running is not supported/
			);
		});
	});

	describe("HostConfigSetPropRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.HostConfigSetPropRequest, testMatrix(
				["controller.name", "invalid"], // field
				["foo", "bar"], // prop
				["Foo Bar", true, 5, {}], // value
			));
		});
		it("runs", async function() {
			this.skip(); // No object fields on host
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				host.handleHostConfigSetPropRequest(new lib.HostConfigSetPropRequest("invalid", "foo", "bar")),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is not an object", async function() {
			await assert.rejects(
				host.handleHostConfigSetPropRequest(new lib.HostConfigSetPropRequest("host.name", "foo", "bar")),
				/Cannot set property on non-object field 'host\.name'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				host.handleHostConfigSetPropRequest(new lib.HostConfigSetPropRequest("host.version", "foo", "bar")),
				/Field 'host\.version' is not accessible from control/
			);
		});
	});

	describe("HostConfigSetRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.HostConfigSetRequest, testMatrix(
				[ // fields
					{ "foo": "bar", "baz": { "cat": "dog" } },
					{ "foo": "5", "baz": { "cat": "5" } },
					{ "foo": "true", "baz": { "cat": "true" } },
					{ "foo": "{}", "baz": { "cat": "{}" } },
				],
			));
		});
		it("runs", async function() {
			await host.handleHostConfigSetRequest(new lib.HostConfigSetRequest({
				"host.name": "Foo Bar",
				"host.factorio_directory": "Bar Baz",
			}));
			assert.equal(host.config.get("host.name"), "Foo Bar");
			assert.equal(host.config.get("host.factorio_directory"), "Bar Baz");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				host.handleHostConfigSetRequest(new lib.HostConfigSetRequest({
					"host.name": "Foo Bar",
					"invalid": "Bar Baz",
				})),
				/No field named 'invalid'/
			);
			assert.equal(host.config.get("host.name"), "New Host");
		});
		it("rejects if the field is not an object", async function() {
			const prevDir = host.config.get("host.factorio_directory");
			await assert.rejects(
				host.handleHostConfigSetRequest(new lib.HostConfigSetRequest({
					"host.name": "Foo Bar",
					"host.factorio_directory": {
						"foo": "bar",
					},
				})),
				/Cannot set property on non-object field 'host\.factorio_directory'/
			);
			assert.equal(host.config.get("host.name"), "New Host");
			assert.equal(host.config.get("host.factorio_directory"), prevDir);
		});
		it("rejects if the field is inaccessible", async function() {
			const prevVersion = host.config.get("host.version");
			await assert.rejects(
				host.handleHostConfigSetRequest(new lib.HostConfigSetRequest({
					"host.name": "Foo Bar",
					"host.version": "2.0.0",
				})),
				/Field 'host\.version' is not accessible from control/
			);
			assert.equal(host.config.get("host.name"), "New Host");
			assert.equal(host.config.get("host.version"), prevVersion);
		});
		it("rejects setting 'host.id'", async function() {
			await assert.rejects(
				host.handleHostConfigSetRequest(new lib.HostConfigSetRequest({
					"host.name": "Foo Bar",
					"host.id": 5,
				})),
				/Setting 'host.id' while host is running is not supported/
			);
			assert.equal(host.config.get("host.name"), "New Host");
		});
	});
});
