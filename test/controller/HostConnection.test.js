import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { Controller, HostConnection, HostRecord } from "@clusterio/controller";
import { MockConnector } from "../mock.js";

const addr = lib.Address.fromShorthand;

function makeSave(instanceId, name) {
	return new lib.SaveDetails(instanceId, "file", name, 0, 0, false, false, 0, false);
}

// Mock saves datastore backed by a Map keyed on SaveDetails.id.
class MockSaves {
	constructor(saves = []) {
		this.saves = new Map(saves.map(s => [s.id, s]));
	}

	get(id) { return this.saves.get(id); }

	values() { return this.saves.values(); }

	setMany(saves) { for (const s of saves) { this.saves.set(s.id, s); } }

	deleteMany(saves) { for (const s of saves) { this.saves.delete(s.id); } }
}

// Mock instances manager where instance id -> assigned host id, and
// optionally instance id -> the name the controller has on record.
function makeInstances(assignments, names = new Map()) {
	return {
		get(id) {
			if (!assignments.has(id)) {
				return undefined;
			}
			const host = assignments.get(id);
			return { config: { get(field) {
				if (field === "instance.assigned_host") { return host; }
				if (field === "instance.name") { return names.get(id); }
				return undefined;
			} } };
		},
	};
}

describe("controller/src/HostConnection", function() {
	describe("host record", function() {
		/** @type {Controller} */
		let controller;
		let record;
		let connector;
		let updates;

		beforeEach(function() {
			controller = new Controller(lib.logger, [], new lib.ControllerConfig("controller"));
			record = new HostRecord(10, "host-10", "1.0.0", new Map(), false, "", "203.0.113.1", 123);
			controller.hosts.set(record);
			connector = new MockConnector(addr("controller"), addr({ hostId: 10 }));
			updates = [];
			controller.hosts.on("update", changed => {
				updates.push(...changed.map(host => ({ id: host.id, name: host.name, isDeleted: host.isDeleted })));
			});
		});

		function connect(id = 10) {
			return new HostConnection(
				new lib.RegisterHostData("", "2.0.0", id, {}), connector, controller, "10.0.0.1"
			);
		}

		function revoke() {
			controller.hosts.delete(record);
			updates.length = 0;
		}

		it("should refuse a host without a record", function() {
			assert.throws(() => connect(11), /Host 11 is not registered/);
			assert.equal(controller.hosts.has(11), false);
			assert.deepEqual(updates, []);
		});
		it("should update the existing record on connect", function() {
			const connection = connect();
			assert.equal(controller.hosts.get(10), record, "host record was replaced");
			assert.equal(connection.id, 10);
			assert.equal(record.connected, true);
			assert.equal(record.version, "2.0.0");
			assert.equal(record.remoteAddress, "10.0.0.1");
			assert.equal(record.name, "host-10");
			assert.equal(record.publicAddress, "203.0.113.1");
			assert.equal(record.tokenValidAfter, 123);
			assert.deepEqual(updates, [{ id: 10, name: "host-10", isDeleted: false }]);
		});
		it("should mark the host disconnected when the connection closes", function() {
			connect();
			updates.length = 0;
			connector.emit("close");
			assert.equal(controller.hosts.get(10), record);
			assert.equal(record.connected, false);
			assert.deepEqual(updates, [{ id: 10, name: "host-10", isDeleted: false }]);
		});
		it("should save info updates from the host", async function() {
			const connection = connect();
			updates.length = 0;
			await connection.handleHostInfoUpdateEvent(
				new lib.HostInfoUpdateEvent(new lib.HostInfoUpdate("renamed", "198.51.100.1"))
			);
			assert.equal(controller.hosts.get(10).name, "renamed");
			assert.equal(controller.hosts.get(10).publicAddress, "198.51.100.1");
			assert.deepEqual(updates, [{ id: 10, name: "renamed", isDeleted: false }]);
		});
		it("should not recreate the record of a revoked host when the connection closes", function() {
			connect();
			revoke();
			connector.emit("close");
			assert.equal(controller.hosts.has(10), false, "host record was recreated");
			assert.deepEqual(updates, []);
		});
		it("should not recreate the record of a revoked host on info updates", async function() {
			const connection = connect();
			revoke();
			await connection.handleHostInfoUpdateEvent(
				new lib.HostInfoUpdateEvent(new lib.HostInfoUpdate("renamed", "198.51.100.1"))
			);
			assert.equal(controller.hosts.has(10), false, "host record was recreated");
			assert.deepEqual(updates, []);
		});
		it("should not overwrite a newer record with the same id", function() {
			connect();
			revoke();
			const newer = new HostRecord(10, "newer", "", new Map());
			controller.hosts.set(newer);
			updates.length = 0;
			connector.emit("close");
			assert.equal(controller.hosts.get(10), newer);
			assert.equal(newer.name, "newer");
			assert.deepEqual(updates, []);
		});
	});

	describe(".handleInstanceSaveDetailsUpdatesEvent()", function() {
		// Instance 1 is on host 10, instance 2 is on host 20.
		const assignments = new Map([[1, 10], [2, 20]]);

		// Inherit the prototype, handlers call other methods on this.
		function run(hostId, saves, event) {
			const saveStore = new MockSaves(saves);
			const ctx = Object.assign(Object.create(HostConnection.prototype), {
				info: { id: hostId },
				_controller: { instances: makeInstances(assignments), saves: saveStore },
			});
			ctx.handleInstanceSaveDetailsUpdatesEvent(event);
			return saveStore;
		}

		it("applies updates for an instance assigned to this host", async function() {
			const store = run(10, [], new lib.InstanceSaveDetailsUpdatesEvent([makeSave(1, "a.zip")], 1));
			assert.deepEqual([...store.values()].map(s => s.id), ["1/a.zip"]);
		});

		it("sweeps missing saves for an instance assigned to this host", async function() {
			const store = run(10, [makeSave(1, "old.zip")], new lib.InstanceSaveDetailsUpdatesEvent([], 1));
			assert.deepEqual([...store.values()], []);
		});

		it("ignores injected saves for an instance on another host", async function() {
			const store = run(30, [], new lib.InstanceSaveDetailsUpdatesEvent([makeSave(1, "HACKED.zip")]));
			assert.deepEqual([...store.values()], [], "foreign save must not be stored");
		});

		it("ignores a wipe of an instance on another host", async function() {
			const existing = makeSave(1, "keep.zip");
			const store = run(30, [existing], new lib.InstanceSaveDetailsUpdatesEvent([], 1));
			assert.deepEqual([...store.values()].map(s => s.id), ["1/keep.zip"], "existing save must survive");
		});

		it("ignores updates for a nonexistent instance", async function() {
			const store = run(30, [], new lib.InstanceSaveDetailsUpdatesEvent([makeSave(999, "x.zip")]));
			assert.deepEqual([...store.values()], []);
		});
	});

	describe(".handleLogMessageEvent()", function() {
		// Instance 1 is on host 10, instance 2 is on host 20.
		const assignments = new Map([[1, 10], [2, 20]]);
		const names = new Map([[1, "one"], [2, "two"]]);

		let warnings = [];
		let originalWarn;
		beforeEach(function() {
			warnings = [];
			originalWarn = lib.logger.warn;
			lib.logger.warn = msg => { warnings.push(msg); };
		});
		afterEach(function() {
			lib.logger.warn = originalWarn;
		});

		// Handlers call other methods on this, so inherit the prototype.
		function makeConnection(hostId) {
			const logged = [];
			const ctx = Object.assign(Object.create(HostConnection.prototype), {
				info: { id: hostId, name: `host-${hostId}` },
				_controller: {
					instances: makeInstances(assignments, names),
					clusterLogger: { log(entry) { logged.push(entry); } },
				},
			});
			return [ctx, logged];
		}

		function run(hostId, info) {
			const [ctx, logged] = makeConnection(hostId);
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(info));
			return logged;
		}

		it("keeps instance fields for an instance assigned to this host", async function() {
			const logged = run(10, { level: "info", message: "hello", instance_id: 1, instance_name: "one" });
			assert.deepEqual(logged, [{
				level: "info", message: "hello", instance_id: 1, instance_name: "one",
				host_id: 10, host_name: "host-10",
			}]);
			assert.deepEqual(warnings, [], "a matching name must not warn");
		});

		it("corrects an instance name which does not match the controller", async function() {
			const logged = run(10, { level: "info", message: "hi", instance_id: 1, instance_name: "wrong" });
			assert.deepEqual(logged, [{
				level: "info", message: "hi", instance_id: 1, instance_name: "one",
				host_id: 10, host_name: "host-10",
			}]);
			assert.equal(warnings.length, 1, "a misaligned name must warn");
		});

		it("warns about a misaligned name again after five minutes", async function() {
			const [ctx, logged] = makeConnection(10);
			const info = { level: "info", message: "hi", instance_id: 1, instance_name: "wrong" };
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(info));
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(info));
			assert.equal(warnings.length, 1, "the warning must not repeat immediately");

			// Pretend the last warning happened just over five minutes ago.
			ctx._lastLogMessageWarnMs -= 5 * 60 * 1000 + 1;
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(info));
			assert.equal(warnings.length, 2, "the warning must resurface after the timeout");
			assert.equal(logged.length, 3);
			assert.deepEqual(logged.map(e => e.instance_name), ["one", "one", "one"]);
		});

		it("shares the warning suppression between bogus id and misaligned name", async function() {
			const [ctx, logged] = makeConnection(10);
			// Instance 2 is on host 20, so this line is bogus.
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(
				{ level: "info", message: "hi", instance_id: 2, instance_name: "two" }
			));
			assert.equal(warnings.length, 1);
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(
				{ level: "info", message: "hi", instance_id: 1, instance_name: "wrong" }
			));
			assert.equal(warnings.length, 1, "both warnings must share the suppression");
			assert.equal(logged[1].instance_name, "one", "the name is still corrected while suppressed");
		});

		it("logs host level messages unchanged", async function() {
			const logged = run(10, { level: "info", message: "hello" });
			assert.deepEqual(logged, [{ level: "info", message: "hello", host_id: 10, host_name: "host-10" }]);
		});

		it("strips instance fields claiming an instance on another host", async function() {
			const logged = run(30, { level: "info", message: "hi", instance_id: 1, instance_name: "one" });
			assert.deepEqual(logged, [{ level: "info", message: "hi", host_id: 30, host_name: "host-30" }]);
		});

		it("strips instance fields claiming a nonexistent instance", async function() {
			const logged = run(30, { level: "info", message: "hi", instance_id: 999, instance_name: "ghost" });
			assert.deepEqual(logged, [{ level: "info", message: "hi", host_id: 30, host_name: "host-30" }]);
		});

		it("overrides host fields sent by the host", async function() {
			const logged = run(10, { level: "info", message: "hi", host_id: 99, host_name: "spoofed" });
			assert.deepEqual(logged, [{ level: "info", message: "hi", host_id: 10, host_name: "host-10" }]);
		});
	});
});
