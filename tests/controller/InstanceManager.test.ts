import t from "tap";
import * as lib from "@clusterio/lib";
import { Controller, InstanceRecord } from "@clusterio/controller";

/** Controller with instance 1 and a recorder on the instanceStatusChanged hook */
function setup(status: lib.InstanceStatus = "unassigned", assignedHost: number | null = null) {
	const config = new lib.InstanceConfig("controller", {
		"instance.id": 1,
		"instance.name": "Test",
		"instance.assigned_host": assignedHost,
	});
	const records = new lib.SubscribableDatastore<InstanceRecord>();
	records.set(new InstanceRecord(config, status));
	const controller = new Controller(
		lib.logger as any, [], new lib.ControllerConfig("controller"),
		undefined, undefined, undefined, undefined, records,
	);
	const calls: [lib.InstanceStatus, lib.InstanceStatus | undefined][] = [];
	controller.hooks.instanceStatusChanged.attach("test", async (instance, prev) => {
		calls.push([instance.status, prev]);
	});
	const instance = controller.instances.getMutable(1)!;
	return { controller, instances: controller.instances, instance, calls };
}

function addHost(controller: Controller, id: number, send: (request: unknown) => Promise<unknown>) {
	controller.wsServer.hostConnections.set(id, { send, connector: { closing: false } } as any);
}

t.test("InstanceManager", async t1 => {
	t1.test("setStatus()", async t2 => {
		t2.test("saves the record and invokes the hook with the previous status", async t3 => {
			const { instances, instance, calls } = setup("stopped");
			const updates: InstanceRecord[] = [];
			instances.records.on("update", (changed: InstanceRecord[]) => updates.push(...changed));
			await instances.setStatus(instance, "starting");
			t3.equal(instance.status, "starting");
			t3.same(updates, [instance]);
			t3.same(calls, [["starting", "stopped"]]);
		});
		t2.test("sets startedAtMs when going from starting to running", async t3 => {
			const { instances, instance } = setup("starting");
			const before = Date.now();
			await instances.setStatus(instance, "running");
			t3.ok(instance.startedAtMs >= before);
		});
		t2.test("keeps startedAtMs when running is reached from another status", async t3 => {
			const { instances, instance } = setup("unknown");
			await instances.setStatus(instance, "running");
			t3.equal(instance.startedAtMs, 0);
		});
	});

	t1.test("assignInstance()", async t2 => {
		t2.test("invokes the hook when unassigning", async t3 => {
			const { controller, instances, calls } = setup("running", 5);
			addHost(controller, 5, async () => {});
			await instances.assignInstance(1, null);
			t3.same(calls, [["unassigned", "running"]]);
		});
		t2.test("invokes the hook when the new host fails the assign", async t3 => {
			const { controller, instances, instance, calls } = setup("unknown", 5);
			addHost(controller, 6, async () => { throw new lib.InternalServerError("failed"); });
			await t3.rejects(instances.assignInstance(1, 6), new lib.InternalServerError("failed"));
			t3.equal(instance.config.get("instance.assigned_host"), null);
			t3.same(calls, [["unassigned", "unknown"]]);
		});
		t2.test("leaves the status to the new host when the assign succeeds", async t3 => {
			const { controller, instances, instance, calls } = setup();
			addHost(controller, 5, async () => {});
			await instances.assignInstance(1, 5);
			t3.equal(instance.status, "unassigned");
			t3.same(calls, []);
		});
	});
});
