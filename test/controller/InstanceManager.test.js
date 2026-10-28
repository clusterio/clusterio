import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

import { Controller, InstanceRecord, InstanceManager } from "@clusterio/controller";

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
			assert.throws(() => instances.getForRequest(999), lib.NotFoundError);
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
				lib.ConflictError
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
				lib.UnavailableError
			);
		});

		it("should do nothing if the host would not change", async function () {
			let assignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			instance.config.set("instance.assigned_host", 5);

			await instances.assignInstance(1, 5);
			assert.equal(assignRequest, undefined);
		});

		it("should not unassign if new host is not connected", async function () {
			let unassignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					unassignRequest = request;
				},
				connector: { closing: false },
			});

			instance.config.set("instance.assigned_host", 5);

			await assert.rejects(
				() => instances.assignInstance(1, 6),
				lib.UnavailableError
			);

			assert.equal(unassignRequest, undefined);
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

		it("should not fail when host has id of 0", async function () {
			let lastEvent;
			controller.wsServer.hostConnections.set(0, {
				send: async (request) => {
					lastEvent = request;
				},
				connector: { closing: false },
			});

			await instances.assignInstance(1, 0);

			assert.equal(instance.config.get("instance.assigned_host"), 0);
			assert(lastEvent instanceof lib.InstanceAssignInternalRequest);
			assert.equal(lastEvent.instanceId, 1);

			await instances.assignInstance(1, null);

			assert.equal(instance.config.get("instance.assigned_host"), null);
			assert(lastEvent instanceof lib.InstanceUnassignInternalRequest);
			assert.equal(lastEvent.instanceId, 1);
		});

		it("should unassign old host if connected", async function () {
			let unassignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					unassignRequest = request;
				},
				connector: { closing: false },
			});

			let assignRequest;
			controller.wsServer.hostConnections.set(6, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			instance.config.set("instance.assigned_host", 5);
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

			let assignRequest;
			controller.wsServer.hostConnections.set(6, {
				send: async (request) => {
					assignRequest = request;
				},
				connector: { closing: false },
			});

			instance.config.set("instance.assigned_host", 5);
			await instances.assignInstance(1, 6);

			assert.equal(unassignRequest, undefined);
			assert(assignRequest instanceof lib.InstanceAssignInternalRequest);
			assert.equal(assignRequest.instanceId, 1);
		});

		it("should leave instance unassigned if the new host fails the assign", async function () {
			let unassignRequest;
			controller.wsServer.hostConnections.set(5, {
				send: async (request) => {
					unassignRequest = request;
				},
				connector: { closing: false },
			});
			let failAssign = true;
			let assignRequest;
			controller.wsServer.hostConnections.set(6, {
				send: async (request) => {
					if (failAssign) {
						throw new lib.InternalServerError("EACCES: permission denied");
					}
					assignRequest = request;
				},
				connector: { closing: false },
			});

			instance.config.set("instance.assigned_host", 5);
			instance.status = "stopped";
			await assert.rejects(
				() => instances.assignInstance(1, 6),
				{ message: "EACCES: permission denied" }
			);

			assert(unassignRequest instanceof lib.InstanceUnassignInternalRequest);
			const stored = instances.records.get(1);
			assert.equal(stored.config.get("instance.assigned_host"), null);
			assert.equal(stored.status, "unassigned");

			failAssign = false;
			await instances.assignInstance(1, 6);
			assert.equal(instance.config.get("instance.assigned_host"), 6);
			assert(assignRequest instanceof lib.InstanceAssignInternalRequest);
			assert.equal(assignRequest.instanceId, 1);
		});
	});

	describe(".unassignInstance()", function () {
		it("should unassign an instance", async function () {
			controller.wsServer.hostConnections.set(5, {
				send: async () => {},
				connector: { closing: true },
			});

			await instances.assignInstance(instance.id, 5);
			await instances.unassignInstance(instance.id);
			assert.equal(instance.config.get("instance.assigned_host"), null);
			assert.equal(instance.status, "unassigned");
		});
		it("should do nothing if the host would not change", async function () {
			instance.config.set("instance.assigned_host", null);

			let fieldChanged;
			instance.config.on("fieldChanged", name => {
				fieldChanged = name;
			});

			await instances.unassignInstance(1);
			assert.equal(fieldChanged, undefined);
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

	describe("inheritance", function () {
		/** @type {InstanceRecord} */
		let base;
		/** @type {InstanceRecord} */
		let child;
		let updated;

		async function createInheritor(id, baseId, fields = {}) {
			const config = new lib.InstanceConfig("controller", {
				"instance.id": id, "instance.name": `Instance ${id}`, "instance.base_id": baseId, ...fields,
			});
			instances.applyBase(config, ["instance.id", "instance.name", "instance.base_id", ...Object.keys(fields)]);
			return await instances.createInstance(config);
		}

		beforeEach(async function () {
			base = await instances.createInstance(new lib.InstanceConfig("controller", {
				"instance.id": 10,
				"instance.name": "Base",
				"instance.is_base": true,
				"factorio.version": "2.0",
				"factorio.settings": { name: "Base server" },
			}));
			child = await createInheritor(11, 10, { "factorio.game_port": 34197 });
			updated = [];
			controller.instanceConfigUpdated = async (inst) => { updated.push(inst.id); };
		});

		describe(".applyBase()", function () {
			it("should copy base values and mark them inherited", function () {
				assert.equal(child.config.get("factorio.version"), "2.0");
				assert.equal(child.config.isInherited("factorio.version"), true);
				assert.equal(child.config.get("factorio.game_port"), 34197);
				assert.equal(child.config.isInherited("factorio.game_port"), false);
				assert.equal(child.config.isInherited("instance.name"), false);
			});
			it("should keep inherited factorio.settings in createInstance", function () {
				assert.deepEqual(child.config.get("factorio.settings"), base.config.get("factorio.settings"));
				assert.notEqual(child.config.get("factorio.settings"), base.config.get("factorio.settings"));
			});
		});

		describe("base changes", function () {
			it("should propagate to inherited fields and send the config to the host", function () {
				base.config.set("factorio.version", "2.1");
				assert.equal(child.config.get("factorio.version"), "2.1");
				assert.equal(child.config.isInherited("factorio.version"), true);
				assert.deepEqual(updated, [11]);
			});
			it("should mark the inheritor as requiring restart", function () {
				child.config.restartRequired = false;
				base.config.set("factorio.version", "2.1");
				assert.equal(child.config.restartRequired, true);
			});
			it("should not touch fields the inheritor has set", function () {
				base.config.set("factorio.game_port", 1234);
				assert.equal(child.config.get("factorio.game_port"), 34197);
				assert.deepEqual(updated, []);
			});
			it("should propagate through several levels", async function () {
				child.config.set("instance.is_base", true);
				const grandchild = await createInheritor(12, 11);
				base.config.setProp("factorio.settings", "max_players", 10);
				assert.equal(grandchild.config.get("factorio.settings").max_players, 10);
				assert.deepEqual(updated.sort(), [11, 12]);
			});
		});

		describe("inheritor changes", function () {
			it("should stop inheriting a field that is changed", function () {
				child.config.set("factorio.version", "2.1");
				assert.equal(child.config.isInherited("factorio.version"), false);
				base.config.set("factorio.version", "2.0.1");
				assert.equal(child.config.get("factorio.version"), "2.1");
			});
			it("should stop inheriting with overrideFields() even if the value is unchanged", function () {
				instances.overrideFields(child, ["factorio.version", "factorio.game_port"]);
				assert.equal(child.config.isInherited("factorio.version"), false);
			});
		});

		describe(".inheritField()", function () {
			it("should restore the base value", function () {
				child.config.set("factorio.version", "2.1");
				instances.inheritField(11, "factorio.version");
				assert.equal(child.config.get("factorio.version"), "2.0");
				assert.equal(child.config.isInherited("factorio.version"), true);
			});
			it("should throw if the instance has no base", function () {
				assert.throws(
					() => instances.inheritField(1, "factorio.version"),
					new lib.ValidationError("Instance does not have a base"),
				);
			});
			it("should throw for fields that cannot be inherited", function () {
				assert.throws(
					() => instances.inheritField(11, "instance.name"),
					new lib.ValidationError("Field instance.name cannot be inherited"),
				);
			});
		});

		describe("base_id changes", function () {
			it("should inherit fields equal to the new base", function () {
				instance.config.set("factorio.version", "2.0");
				instance.config.set("instance.base_id", 10);
				assert.equal(instance.config.isInherited("factorio.version"), true);
				assert.equal(instance.config.isInherited("factorio.settings"), false);
			});
			it("should clear inherited fields when the base is removed", function () {
				child.config.set("instance.base_id", null);
				assert.deepEqual(child.config.get("instance.inherited_fields"), {});
				assert.equal(child.config.get("factorio.version"), "2.0");
			});
		});

		describe(".checkInheritance()", function () {
			it("should accept a valid base", function () {
				instances.checkInheritance(instance.config, false, 10);
			});
			it("should reject a missing base", function () {
				assert.throws(
					() => instances.checkInheritance(instance.config, false, 99),
					new lib.NotFoundError("Instance with ID 99 does not exist"),
				);
			});
			it("should reject an instance that is not a base", function () {
				assert.throws(
					() => instances.checkInheritance(instance.config, false, 11),
					new lib.ValidationError("Instance Instance 11 is not a base"),
				);
			});
			it("should reject cycles", function () {
				child.config.set("instance.is_base", true);
				assert.throws(
					() => instances.checkInheritance(base.config, true, 11),
					new lib.ValidationError("Base instances cannot inherit from themselves"),
				);
			});
			it("should reject making an assigned instance a base", function () {
				instance.config.set("instance.assigned_host", 5);
				assert.throws(
					() => instances.checkInheritance(instance.config, true, null),
					new lib.ConflictError("Instance must be unassigned before it can be made a base"),
				);
			});
			it("should reject unmarking a base that has inheritors", function () {
				assert.throws(
					() => instances.checkInheritance(base.config, false, null),
					new lib.ConflictError("Instance is the base of 1 other instance(s)"),
				);
			});
		});

		it("should not assign a base to a host", async function () {
			controller.wsServer.hostConnections.set(5, { send: async () => {}, connector: { closing: false } });
			await assert.rejects(
				instances.assignInstance(10, 5),
				new lib.ValidationError("Base instances cannot be assigned to a host"),
			);
		});

		it("should not delete a base that has inheritors", async function () {
			await assert.rejects(
				instances.deleteInstance(10),
				new lib.ConflictError("Instance is the base of 1 other instance(s)"),
			);
		});

		it("should report bases in instance details", function () {
			assert.equal(base.toInstanceDetails().isBase, true);
			assert.equal(child.toInstanceDetails().isBase, false);
		});
	});
});
