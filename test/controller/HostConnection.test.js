import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { HostConnection } from "@clusterio/controller";

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

// Mock instances manager where instance id -> assigned host id.
function makeInstances(assignments) {
	return {
		get(id) {
			if (!assignments.has(id)) {
				return undefined;
			}
			const host = assignments.get(id);
			return { config: { get: name => (name === "instance.assigned_host" ? host : undefined) } };
		},
	};
}

describe("controller/src/HostConnection", function() {
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

		function run(hostId, info) {
			const logged = [];
			const ctx = Object.assign(Object.create(HostConnection.prototype), {
				info: { id: hostId, name: `host-${hostId}` },
				_controller: {
					instances: makeInstances(assignments),
					clusterLogger: { log(entry) { logged.push(entry); } },
				},
			});
			ctx.handleLogMessageEvent(new lib.LogMessageEvent(info));
			return logged;
		}

		it("keeps instance fields for an instance assigned to this host", async function() {
			const logged = run(10, { level: "info", message: "hello", instance_id: 1, instance_name: "one" });
			assert.deepEqual(logged, [{
				level: "info", message: "hello", instance_id: 1, instance_name: "one",
				host_id: 10, host_name: "host-10",
			}]);
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
