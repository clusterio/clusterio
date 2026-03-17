"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Controller, ControlConnection } = require("@clusterio/controller");
const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

describe("messages/controller", function() {
	/** @type {Controller} */
	let controller;
	/** @type {ControlConnection} */
	let controlConnection;
	/** @type {lib.InstanceConfig} */
	let instanceConfig;

	beforeEach(function() {
		const controllerConfig = new lib.ControllerConfig("controller");
		const connection = new lib.VirtualConnector(
			lib.Address.fromShorthand("controller"),
			lib.Address.fromShorthand({ controlId: 1 }),
		);
		controller = new Controller(lib.logger, [], controllerConfig);
		instanceConfig = new lib.InstanceConfig("controller");
		controller.instances.createInstance(instanceConfig);
		const user = controller.users.getOrCreateUser("test");
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

	describe("ControllerConfigGetRequest", function() {
		it("runs", async function() {
			const config = await controlConnection.handleControllerConfigGetRequest(
				new lib.ControllerConfigGetRequest()
			);
			assert.deepEqual(config, controller.config.toRemote("control"));
		});
	});

	describe("ControllerConfigSetFieldRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.ControllerConfigSetFieldRequest, testMatrix(
				["controller.name", "invalid"], // field
				["Foo Bar", "true", "5", "{}"], // value
			));
		});
		it("runs", async function() {
			await controlConnection.handleControllerConfigSetFieldRequest(
				new lib.ControllerConfigSetFieldRequest("controller.name", "Foo Bar")
			);
			assert.equal(controller.config.get("controller.name"), "Foo Bar");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetFieldRequest(
					new lib.ControllerConfigSetFieldRequest("invalid", "Foo Bar")
				),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetFieldRequest(
					new lib.ControllerConfigSetFieldRequest("controller.version", "2.0.0")
				),
				/Field 'controller.version' is not accessible from control/
			);
		});
	});

	describe("ControllerConfigSetPropRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.ControllerConfigSetPropRequest, testMatrix(
				["controller.name", "invalid"], // field
				["foo", "bar"], // prop
				["Foo Bar", true, 5, {}], // value
			));
		});
		it("runs", async function() {
			this.skip(); // No object fields on controller
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetPropRequest(
					new lib.ControllerConfigSetPropRequest("invalid", "foo", "bar")
				),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is not an object", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetPropRequest(
					new lib.ControllerConfigSetPropRequest("controller.name", "foo", "bar")
				),
				/Cannot set property on non-object field 'controller\.name'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetPropRequest(
					new lib.ControllerConfigSetPropRequest("controller.version", "foo", "bar")
				),
				/Field 'controller\.version' is not accessible from control/
			);
		});
	});

	describe("ControllerConfigSetRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.ControllerConfigSetRequest, testMatrix(
				[ // fields
					{ "foo": "bar", "baz": { "cat": "dog" } },
					{ "foo": "5", "baz": { "cat": "5" } },
					{ "foo": "true", "baz": { "cat": "true" } },
					{ "foo": "{}", "baz": { "cat": "{}" } },
				],
			));
		});
		it("runs", async function() {
			await controlConnection.handleControllerConfigSetRequest(new lib.ControllerConfigSetRequest({
				"controller.name": "Foo Bar",
				"controller.mods_directory": "Bar Baz",
			}));
			assert.equal(controller.config.get("controller.name"), "Foo Bar");
			assert.equal(controller.config.get("controller.mods_directory"), "Bar Baz");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleControllerConfigSetRequest(new lib.ControllerConfigSetRequest({
					"controller.name": "Foo Bar",
					"invalid": "Bar Baz",
				})),
				/No field named 'invalid'/
			);
			assert.equal(controller.config.get("controller.name"), "Your Cluster");
		});
		it("rejects if the field is not an object", async function() {
			const prevDir = controller.config.get("controller.mods_directory");
			await assert.rejects(
				controlConnection.handleControllerConfigSetRequest(new lib.ControllerConfigSetRequest({
					"controller.name": "Foo Bar",
					"controller.mods_directory": {
						"foo": "bar",
					},
				})),
				/Cannot set property on non-object field 'controller\.mods_directory'/
			);
			assert.equal(controller.config.get("controller.name"), "Your Cluster");
			assert.equal(controller.config.get("controller.mods_directory"), prevDir);
		});
		it("rejects if the field is inaccessible", async function() {
			const prevVersion = controller.config.get("controller.version");
			await assert.rejects(
				controlConnection.handleControllerConfigSetRequest(new lib.ControllerConfigSetRequest({
					"controller.name": "Foo Bar",
					"controller.version": "2.0.0",
				})),
				/Field 'controller\.version' is not accessible from control/
			);
			assert.equal(controller.config.get("controller.name"), "Your Cluster");
			assert.equal(controller.config.get("controller.version"), prevVersion);
		});
	});

	describe("InstanceConfigGetRequest", function() {
		it("runs", async function() {
			const config = await controlConnection.handleInstanceConfigGetRequest(
				new lib.InstanceConfigGetRequest(instanceConfig.get("instance.id"))
			);
			assert.deepEqual(config, instanceConfig.toRemote("control"));
		});
	});

	describe("InstanceConfigSetFieldRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.InstanceConfigSetFieldRequest, testMatrix(
				[1], // instance id
				["controller.name", "invalid"], // field
				["Foo Bar", "true", "5", "{}"], // value
			));
		});
		it("runs", async function() {
			await controlConnection.handleInstanceConfigSetFieldRequest(
				new lib.InstanceConfigSetFieldRequest(instanceConfig.get("instance.id"), "instance.name", "Foo Bar")
			);
			assert.equal(instanceConfig.get("instance.name"), "Foo Bar");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetFieldRequest(
					new lib.InstanceConfigSetFieldRequest(instanceConfig.get("instance.id"), "invalid", "Foo Bar")
				),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetFieldRequest(
					new lib.InstanceConfigSetFieldRequest(
						instanceConfig.get("instance.id"), "factorio.host_assigned_game_port", "3000"
					)
				),
				/Field 'factorio\.host_assigned_game_port' is not accessible from control/
			);
		});
		it("rejects setting 'instance.assigned_host'", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetFieldRequest(
					new lib.InstanceConfigSetFieldRequest(
						instanceConfig.get("instance.id"), "instance.assigned_host", 5
					)
				),
				/instance\.assigned_host must be set through the assign-host interface/
			);
		});
		it("rejects setting 'instance.id'", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetFieldRequest(
					new lib.InstanceConfigSetFieldRequest(
						instanceConfig.get("instance.id"), "instance.id", 5
					)
				),
				/Setting instance\.id is not supported/
			);
		});
	});

	describe("InstanceConfigSetPropRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.InstanceConfigSetPropRequest, testMatrix(
				[1], // instance id
				["controller.name", "invalid"], // field
				["foo", "bar"], // prop
				["Foo Bar", true, 5, {}], // value
			));
		});
		it("runs", async function() {
			controlConnection.handleInstanceConfigSetPropRequest(
				new lib.InstanceConfigSetPropRequest(
					instanceConfig.get("instance.id"), "factorio.settings", "name", "Foo Bar"
				)
			);
			const { name, ...rest } = instanceConfig.get("factorio.settings");
			assert.equal(name, "Foo Bar");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetPropRequest(
					new lib.InstanceConfigSetPropRequest(instanceConfig.get("instance.id"), "invalid", "foo", "bar")
				),
				/No field named 'invalid'/
			);
		});
		it("rejects if the field is not an object", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetPropRequest(
					new lib.InstanceConfigSetPropRequest(
						instanceConfig.get("instance.id"), "instance.name", "foo", "bar"
					)
				),
				/Cannot set property on non-object field 'instance\.name'/
			);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetPropRequest(
					new lib.InstanceConfigSetPropRequest(
						instanceConfig.get("instance.id"), "factorio.host_assigned_game_port", "foo", "bar"
					)
				),
				/Field 'factorio\.host_assigned_game_port' is not accessible from control/
			);
		});
	});

	describe("InstanceConfigSetRequest", function() {
		it("is round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.InstanceConfigSetRequest, testMatrix(
				[1], // instance id
				[ // fields
					{ "foo": "bar", "baz": { "cat": "dog" } },
					{ "foo": "5", "baz": { "cat": "5" } },
					{ "foo": "true", "baz": { "cat": "true" } },
					{ "foo": "{}", "baz": { "cat": "{}" } },
				],
			));
		});
		it("runs", async function() {
			await controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
				instanceConfig.get("instance.id"), {
					"instance.name": "Foo Bar",
					"factorio.executable_path": "Bar Baz",
				})
			);
			assert.equal(instanceConfig.get("instance.name"), "Foo Bar");
			assert.equal(instanceConfig.get("factorio.executable_path"), "Bar Baz");
		});
		it("rejects if the field does not exist", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
					instanceConfig.get("instance.id"), {
						"instance.name": "Foo Bar",
						"invalid": "Bar Baz",
					})
				),
				/No field named 'invalid'/
			);
			assert.equal(instanceConfig.get("instance.name"), "New Instance");
		});
		it("rejects if the field is not an object", async function() {
			const prevPath = instanceConfig.get("factorio.executable_path");
			await assert.rejects(
				controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
					instanceConfig.get("instance.id"), {
						"instance.name": "Foo Bar",
						"factorio.executable_path": {
							"foo": "bar",
						},
					})
				),
				/Cannot set property on non-object field 'factorio\.executable_path'/
			);
			assert.equal(instanceConfig.get("instance.name"), "New Instance");
			assert.equal(instanceConfig.get("factorio.executable_path"), prevPath);
		});
		it("rejects if the field is inaccessible", async function() {
			await assert.rejects(
				controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
					instanceConfig.get("instance.id"), {
						"instance.name": "Foo Bar",
						"factorio.host_assigned_game_port": "Bar Baz",
					})
				),
				/Field 'factorio\.host_assigned_game_port' is not accessible from control/
			);
			assert.equal(instanceConfig.get("instance.name"), "New Instance");
			// Can't check value of host_assigned_game_port as it is not accessible on controller
		});
		it("rejects setting 'instance.assigned_host'", async function() {
			const prevHost = instanceConfig.get("instance.assigned_host");
			await assert.rejects(
				controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
					instanceConfig.get("instance.id"), {
						"instance.name": "Foo Bar",
						"instance.assigned_host": 5,
					})
				),
				/instance\.assigned_host must be set through the assign-host interface/
			);
			assert.equal(instanceConfig.get("instance.name"), "New Instance");
			assert.equal(instanceConfig.get("instance.assigned_host"), prevHost);
		});
		it("rejects setting 'instance.id'", async function() {
			const prevId = instanceConfig.get("instance.id");
			await assert.rejects(
				controlConnection.handleInstanceConfigSetRequest(new lib.InstanceConfigSetRequest(
					instanceConfig.get("instance.id"), {
						"instance.name": "Foo Bar",
						"instance.id": 5,
					})
				),
				/Setting instance\.id is not supported/
			);
			assert.equal(instanceConfig.get("instance.name"), "New Instance");
			assert.equal(instanceConfig.get("instance.id"), prevId);
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
