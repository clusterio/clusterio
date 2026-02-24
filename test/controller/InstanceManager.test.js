"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Controller, InstanceRecord, InstanceManager } = require("@clusterio/controller");

describe("controller/InstanceManager", function () {
	/** @type {Controller} */
	let controller;
	/** @type {InstanceManager} */
	let instances;
	/** @type {InstanceRecord} */
	let instance;

	beforeEach(function () {
		const controllerConfig = new lib.ControllerConfig("controller", {
			"controller.name": "TestController",
		});
		const instanceConfig = new lib.InstanceConfig("controller", {
			"instance.id": 1,
			"instance.name": "Test",
		});

		const datastoreInstances = new lib.SubscribableDatastore();
		datastoreInstances.set(new InstanceRecord(instanceConfig, "unassigned"));

		controller = new Controller(lib.logger, [], controllerConfig,
			undefined, undefined, undefined, undefined, datastoreInstances);
		instances = controller.instances;
		instance = instances.getMutable(1);
	});

	describe("constructor()", function () {
		it("should call _notifyConfigFieldChanged when config changes", async function () {
			let called = false;

			instances._notifyConfigFieldChanged = async (
				inst, field, curr, prev
			) => {
				called = true;
				assert.equal(inst.id, 1);
				assert.equal(field, "instance.name");
				assert.equal(prev, "Test");
				assert.equal(curr, "Updated");
			};

			instance.config.set("instance.name", "Updated");

			assert.equal(called, true);
		});

		it("should update datastore when config changes", function () {
			let setCalled = false;

			const originalSet = instances.records.set.bind(instances.records);
			instances.records.set = function (value) {
				setCalled = true;
				return originalSet(value);
			};

			instance.config.set("instance.name", "Changed");

			assert.equal(setCalled, true);
		});
	});

	describe(".has() / .get() / .getMutable()", function () {
		it("should return instance when exists", async function () {
			assert.equal(instances.has(instance.id), true);
			assert.equal(instances.get(instance.id), instance);
			assert.equal(instances.getMutable(instance.id), instance);
		});

		it("should return undefined when missing", function () {
			assert.equal(instances.has(999), false);
			assert.equal(instances.get(999), undefined);
		});
	});

	describe(".values() / .valuesMutable()", function () {
		it("should iterate all instances", async function () {
			const config1 = new lib.InstanceConfig("controller", {
				"instance.id": 2,
				"instance.name": "A",
			});
			const config2 = new lib.InstanceConfig("controller", {
				"instance.id": 3,
				"instance.name": "B",
			});

			const i1 = await instances.createInstance(config1);
			const i2 = await instances.createInstance(config2);

			assert.deepEqual(Array.from(instances.values()), [instance, i1, i2]);
			assert.deepEqual(Array.from(instances.valuesMutable()), [instance, i1, i2]);
		});
	});

	describe(".getForRequest()", function () {
		it("should return instance when exists", async function () {
			assert.equal(instances.getForRequest(1), instance);
		});

		it("should throw when missing", function () {
			assert.throws(() => instances.getForRequest(999), lib.RequestError);
		});
	});

	describe(".createInstance()", function () {
		it("should create new instance with id 2", async function () {
			let notified = false;
			instances._notifyStatusChanged = async () => { notified = true; };

			const config = new lib.InstanceConfig("controller", {
				"instance.id": 2,
				"instance.name": "Second",
			});

			const created = await instances.createInstance(config);

			assert.equal(created.id, 2);
			assert(instances.get(2), created);
			assert.equal(notified, true);
		});

		it("should call notify on config change", async function () {
			let notified = false;
			instances._notifyConfigFieldChanged = async () => { notified = true; };

			const config = new lib.InstanceConfig("controller", {
				"instance.id": 2,
				"instance.name": "Second",
			});

			const created = await instances.createInstance(config);

			created.config.set("instance.name", "Updated");

			assert.equal(created.id, 2);
			assert.equal(instances.get(2), created);
			assert.equal(notified, true);
		});

		it("should throw if id already exists", async function () {
			const config = new lib.InstanceConfig("controller", {
				"instance.id": 1,
				"instance.name": "Duplicate",
			});

			await assert.rejects(
				() => instances.createInstance(config),
				lib.RequestError
			);
		});

		it("should suppress changes when flag set", async function () {
			let notified = false;
			instances._notifyStatusChanged = async () => { notified = true; };

			const config = new lib.InstanceConfig("controller", {
				"instance.id": 2,
				"instance.name": "Suppressed",
			});

			const created = await instances.createInstance(config, true);

			assert.equal(instances.get(2), undefined);
			assert.equal(notified, false);
		});
	});

	describe(".assignInstance()", function () {
		it("should throw if host not connected", async function () {
			await assert.rejects(
				() => instances.assignInstance(1, 5),
				lib.RequestError
			);
		});

		it("should assign to connected host", async function () {
			let assignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			await instances.assignInstance(1, 5);

			assert.equal(instance.config.get("instance.assigned_host"), 5);
			assert(assignRequest instanceof lib.InstanceAssignInternalRequest);
			assert.equal(assignRequest.instanceId, 1);
		});

		it("should unassign old host if connected", async function () {
			let unassignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					unassignRequest = request;
				},
				connector: { closing: false },
			});

			await instances.assignInstance(1, 5);

			let assignRequest;
			controller.wsServer.hostConnections.set(6, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			await instances.assignInstance(1, 6);

			assert(unassignRequest instanceof lib.InstanceUnassignInternalRequest);
			assert.equal(unassignRequest.instanceId, 1);
			assert(assignRequest instanceof lib.InstanceAssignInternalRequest);
			assert.equal(assignRequest.instanceId, 1);
		});

		it("should not unassign if old host closing", async function () {
			let unassignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					unassignRequest = request;
				},
				connector: { closing: true },
			});

			await instances.assignInstance(1, 5);

			let assignRequest;
			controller.wsServer.hostConnections.set(6, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			unassignRequest = undefined;
			await instances.assignInstance(1, 6);

			assert.equal(unassignRequest, undefined);
			assert(assignRequest instanceof lib.InstanceAssignInternalRequest);
			assert.equal(assignRequest.instanceId, 1);
		});
	});

	describe(".unassignInstance()", function () {
		it("should delegate to assignInstance", async function () {
			await instances.unassignInstance(instance.id);
			assert.equal(instance.config.get("instance.assigned_host"), null);
		});
	});

	describe(".deleteInstance()", function () {
		it("should delete and notify", async function () {
			let notified = false;
			instances._notifyStatusChanged = async () => { notified = true; };

			await instances.deleteInstance(1);

			assert.equal(instances.get(1), undefined);
			assert.equal(notified, true);
		});

		it("should send delete to host if assigned", async function () {
			let sentRequest;
			controller.sendTo = async (_target, request) => {
				sentRequest = request;
			};

			controller.wsServer.hostConnections.set(5, {
				send: async () => {},
				connector: { closing: false },
			});

			await instances.assignInstance(1, 5);
			await instances.deleteInstance(1);

			assert(sentRequest instanceof lib.InstanceDeleteInternalRequest);
			assert.equal(sentRequest.instanceId, 1);
		});
	});
});
