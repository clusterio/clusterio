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
		let template;
		/** @type {InstanceRecord} */
		let child;
		let updated;

		async function createInheritor(id, templateId, fields = {}) {
			const config = new lib.InstanceConfig("controller", {
				"instance.id": id, "instance.name": `Instance ${id}`, "instance.template_id": templateId, ...fields,
			});
			instances.applyTemplate(
				config, ["instance.id", "instance.name", "instance.template_id", ...Object.keys(fields)]
			);
			return await instances.createInstance(config);
		}

		beforeEach(async function () {
			template = await instances.createInstance(new lib.InstanceConfig("controller", {
				"instance.id": 10,
				"instance.name": "Template",
				"instance.is_template": true,
				"factorio.version": "2.0",
				"factorio.game_port": 34190,
				"factorio.settings": { name: "Template server", max_players: 5 },
			}));
			child = await createInheritor(11, 10, { "factorio.game_port": 34197 });
			updated = [];
			controller.instanceConfigUpdated = async (inst) => { updated.push(inst.id); };
		});

		describe(".applyTemplate()", function () {
			it("should copy template values and mark them inherited", function () {
				assert.equal(child.config.get("factorio.version"), "2.0");
				assert.equal(child.config.isInherited("factorio.version"), true);
				assert.equal(child.config.get("factorio.game_port"), 34197);
				assert.equal(child.config.isInherited("factorio.game_port"), false);
				assert.equal(child.config.isInherited("instance.name"), false);
			});
			it("should never inherit ports or the rcon password", function () {
				template.config.set("factorio.rcon_password", "secret");
				const config = new lib.InstanceConfig("controller", { "instance.id": 12, "instance.template_id": 10 });
				instances.applyTemplate(config, ["instance.id", "instance.template_id"]);
				assert.equal(config.get("factorio.game_port"), null);
				assert.equal(config.isInherited("factorio.game_port"), false);
				assert.equal(config.get("factorio.rcon_password"), null);
				assert.equal(config.isInherited("factorio.rcon_password"), false);
			});
			it("should inherit factorio.settings per property with its own server name", function () {
				const settings = child.config.get("factorio.settings");
				assert.equal(settings.max_players, 5);
				assert.equal(settings.name, "TestController - Instance 11");
				assert.equal(child.config.isInherited("factorio.settings", "max_players"), true);
				assert.equal(child.config.isInherited("factorio.settings", "name"), false);
			});
			it("should keep properties given by the creator as overrides", async function () {
				const other = await createInheritor(12, 10, { "factorio.settings": { max_players: 8 } });
				assert.equal(other.config.get("factorio.settings").max_players, 8);
				assert.equal(other.config.isInherited("factorio.settings", "max_players"), false);
				assert.equal(other.config.isInherited("factorio.settings", "auto_pause"), true);
			});
		});

		describe("template changes", function () {
			it("should propagate to inherited fields and send the config to the host", function () {
				template.config.set("factorio.version", "2.1");
				assert.equal(child.config.get("factorio.version"), "2.1");
				assert.equal(child.config.isInherited("factorio.version"), true);
				assert.deepEqual(updated, [11]);
			});
			it("should mark the inheritor as requiring restart", function () {
				child.config.restartRequired = false;
				template.config.set("factorio.version", "2.1");
				assert.equal(child.config.restartRequired, true);
			});
			it("should not touch fields the inheritor has set", function () {
				child.config.set("factorio.version", "2.1");
				template.config.set("factorio.version", "2.2");
				assert.equal(child.config.get("factorio.version"), "2.1");
			});
			it("should merge object properties and keep overrides", function () {
				template.config.setProp("factorio.settings", "max_players", 10);
				template.config.setProp("factorio.settings", "name", "Renamed");
				template.config.setProp("factorio.settings", "auto_pause", true);
				const settings = child.config.get("factorio.settings");
				assert.equal(settings.max_players, 10);
				assert.equal(settings.auto_pause, true);
				assert.equal(settings.name, "TestController - Instance 11");
			});
			it("should propagate through several levels", async function () {
				child.config.set("instance.is_template", true);
				const grandchild = await createInheritor(12, 11);
				template.config.setProp("factorio.settings", "max_players", 10);
				assert.equal(grandchild.config.get("factorio.settings").max_players, 10);
				assert.deepEqual(updated.sort(), [11, 12]);
			});
		});

		describe("inheritor changes", function () {
			it("should stop inheriting a field that is changed", function () {
				child.config.set("factorio.version", "2.1");
				assert.equal(child.config.isInherited("factorio.version"), false);
			});
			it("should only override the properties changed in an object", function () {
				child.config.setProp("factorio.settings", "max_players", 3);
				assert.equal(child.config.isInherited("factorio.settings", "max_players"), false);
				assert.equal(child.config.isInherited("factorio.settings", "auto_pause"), true);
			});
			it("should restore the template value of a removed property", function () {
				child.config.setProp("factorio.settings", "max_players", 3);
				child.config.setProp("factorio.settings", "max_players");
				assert.equal(child.config.get("factorio.settings").max_players, 5);
				assert.equal(child.config.isInherited("factorio.settings", "max_players"), true);
			});
			it("should stop inheriting with overrideField() even if the value is unchanged", function () {
				instances.overrideField(child, "factorio.version");
				instances.overrideField(child, "factorio.settings", ["auto_pause"]);
				assert.equal(child.config.isInherited("factorio.version"), false);
				assert.equal(child.config.isInherited("factorio.settings", "auto_pause"), false);
			});
		});

		describe(".inheritField()", function () {
			it("should restore the template value", function () {
				child.config.set("factorio.version", "2.1");
				instances.inheritField(11, "factorio.version");
				assert.equal(child.config.get("factorio.version"), "2.0");
				assert.equal(child.config.isInherited("factorio.version"), true);
			});
			it("should restore a single property", function () {
				child.config.setProp("factorio.settings", "max_players", 3);
				instances.inheritField(11, "factorio.settings", "max_players");
				assert.equal(child.config.get("factorio.settings").max_players, 5);
				assert.equal(child.config.get("factorio.settings").name, "TestController - Instance 11");
			});
			it("should restore all properties", function () {
				instances.inheritField(11, "factorio.settings");
				assert.equal(child.config.get("factorio.settings").name, "Template server");
			});
			it("should throw if the instance has no template", function () {
				assert.throws(
					() => instances.inheritField(1, "factorio.version"),
					new lib.ValidationError("Instance does not have a template"),
				);
			});
			it("should throw for fields that cannot be inherited", function () {
				assert.throws(
					() => instances.inheritField(11, "instance.name"),
					new lib.ValidationError("Field instance.name cannot be inherited"),
				);
				assert.throws(
					() => instances.inheritField(11, "factorio.rcon_port"),
					new lib.ValidationError("Field factorio.rcon_port cannot be inherited"),
				);
			});
		});

		describe("template_id changes", function () {
			it("should inherit fields equal to the template or the default", function () {
				instance.config.set("factorio.version", "2.0");
				instance.config.set("factorio.verbose_logging", true);
				template.config.set("instance.auto_start", true);
				instance.config.set("instance.template_id", 10);
				assert.equal(instance.config.isInherited("factorio.version"), true);
				assert.equal(instance.config.isInherited("instance.auto_start"), true);
				assert.equal(instance.config.get("instance.auto_start"), true);
				assert.equal(instance.config.isInherited("factorio.verbose_logging"), false);
			});
			it("should inherit object properties equal to the template or the default", function () {
				instance.config.setProp("factorio.settings", "max_players", 0);
				instance.config.setProp("factorio.settings", "game_password", "secret");
				instance.config.set("instance.template_id", 10);
				const settings = instance.config.get("factorio.settings");
				assert.equal(settings.max_players, 5);
				assert.equal(settings.game_password, "secret");
				assert.equal(instance.config.isInherited("factorio.settings", "game_password"), false);
				assert.equal(instance.config.isInherited("factorio.settings", "max_players"), true);
			});
			it("should keep the server name of the instance", function () {
				instance.config.setProp("factorio.settings", "name", "Template server");
				instance.config.set("instance.template_id", 10);
				assert.equal(instance.config.isInherited("factorio.settings", "name"), false);
			});
			it("should clear inherited fields when the template is removed", function () {
				child.config.set("instance.template_id", null);
				assert.deepEqual(child.config.get("instance.inherited_fields"), {});
				assert.equal(child.config.get("factorio.version"), "2.0");
			});
		});

		describe(".checkInheritance()", function () {
			it("should accept a valid template", function () {
				instances.checkInheritance(instance.config, false, 10);
			});
			it("should reject a missing template", function () {
				assert.throws(
					() => instances.checkInheritance(instance.config, false, 99),
					new lib.NotFoundError("Instance with ID 99 does not exist"),
				);
			});
			it("should reject an instance that is not a template", function () {
				assert.throws(
					() => instances.checkInheritance(instance.config, false, 11),
					new lib.ValidationError("Instance Instance 11 is not a template"),
				);
			});
			it("should reject cycles", function () {
				child.config.set("instance.is_template", true);
				assert.throws(
					() => instances.checkInheritance(template.config, true, 11),
					new lib.ValidationError("Templates cannot inherit from themselves"),
				);
			});
			it("should reject making an assigned instance a template", function () {
				instance.config.set("instance.assigned_host", 5);
				assert.throws(
					() => instances.checkInheritance(instance.config, true, null),
					new lib.ConflictError("Instance must be unassigned before it can be made a template"),
				);
			});
			it("should reject unmarking a template that has inheritors", function () {
				assert.throws(
					() => instances.checkInheritance(template.config, false, null),
					new lib.ConflictError("Instance is the template of 1 other instance(s)"),
				);
			});
		});

		it("should not assign a template to a host", async function () {
			controller.wsServer.hostConnections.set(5, { send: async () => {}, connector: { closing: false } });
			await assert.rejects(
				instances.assignInstance(10, 5),
				new lib.ValidationError("Templates cannot be assigned to a host"),
			);
		});

		it("should not delete a template that has inheritors", async function () {
			await assert.rejects(
				instances.deleteInstance(10),
				new lib.ConflictError("Instance is the template of 1 other instance(s)"),
			);
		});

		it("should report templates in instance details", function () {
			assert.equal(template.toInstanceDetails().isTemplate, true);
			assert.equal(child.toInstanceDetails().isTemplate, false);
		});
	});
});
