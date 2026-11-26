import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { testHost } from "../shared/host.ts";
import type { testInstance } from "../shared/instance.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const unassign = (id: number) => new lib.InstanceUnassignInternalRequest(id);

/**
 * Let _startSave bring the instance up to running without Factorio
 *
 * @returns calls made to server.stop.
 */
function stubStart(tt: Test, { instance, server }: ReturnType<typeof testInstance>) {
	tt.intercept(instance, "prepare", { value: async () => {} });
	tt.intercept(instance, "prepareSave", { value: async () => "save.zip" });
	tt.intercept(instance, "writeServerSettings", { value: async () => ({}) });
	tt.intercept(instance, "sendSaveListUpdate", { value: async () => {} });
	tt.intercept(server, "start", { value: async () => { server._state = "running"; } });
	tt.intercept(server, "disableAchievements", { value: async () => false });
	tt.intercept(server, "sendRcon", { value: async () => "" });
	return tt.intercept(server, "stop", {
		value: async () => {
			server._state = "init";
			server.emit("exit");
		},
	});
}

/** Start an instance and hold it in prepare until the returned function is called */
async function startHeld(tt: Test, made: ReturnType<typeof testInstance>) {
	const stop = stubStart(tt, made);
	let finishPrepare!: () => void;
	tt.intercept(made.instance, "prepare", {
		value: () => new Promise<void>(resolve => { finishPrepare = resolve; }),
	});
	const started = made.instance._startSave();
	await tick();
	return {
		stop,
		async finish() {
			finishPrepare();
			await started;
		},
	};
}

t.test("Host", async t1 => {
	t1.test("instanceStatus()", async t2 => {
		t2.test("is stopped for an instance that is not connected", async t3 => {
			const { host, assign } = testHost(t3);
			assign(7);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		t2.test("is starting while waiting on fromConfig", async t3 => {
			const { host, assign, holdStarts } = testHost(t3);
			assign(7);
			const release = holdStarts();
			const connecting = host._connectInstance(7);
			await tick();
			t3.equal(host.instanceStatus(7), "starting");
			release();
			await connecting;
		});
		t2.test("is the status of a connected instance", async t3 => {
			const { host, assign, connect } = testHost(t3);
			assign(7);
			const { instance } = await connect(7);
			instance.notifyStatus("exporting_data");
			t3.equal(host.instanceStatus(7), "exporting_data");
		});
	});

	t1.test("_connectInstance()", async t2 => {
		t2.test("rejects while the host is shutting down", async t3 => {
			const { host, assign } = testHost(t3);
			assign(7);
			host._shuttingDown = true;
			await t3.rejects(host._connectInstance(7), new lib.UnavailableError("Host is shutting down"));
		});
		t2.test("rejects a second start while the first waits on fromConfig", async t3 => {
			const { host, assign, holdStarts } = testHost(t3);
			assign(7);
			const release = holdStarts();
			const first = host._connectInstance(7);
			await t3.rejects(host._connectInstance(7), new lib.ConflictError("Instance with ID 7 is running"));
			release();
			await first;
		});
	});

	t1.test("handleInstanceUnassignInternalRequest()", async t2 => {
		t2.test("unassigns a stopped instance", async t3 => {
			const { host, assign } = testHost(t3);
			assign(7);
			await host.handleInstanceUnassignInternalRequest(unassign(7));
			t3.equal(host.assignedInstances.has(7), false);
		});
		t2.test("stops an instance once a pending start connects and runs", async t3 => {
			const { host, assign, holdStarts, instances } = testHost(t3);
			assign(7);
			const release = holdStarts();
			const connecting = host._connectInstance(7);
			await tick();
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			release();
			await connecting;
			const made = instances.get(7)!;
			const stop = stubStart(t3, made);
			await made.instance._startSave();
			await unassigned;
			t3.equal(stop().length, 1);
			t3.same(made.statuses(), ["running", "stopping", "stopped"]);
			t3.equal(host.assignedInstances.has(7), false);
		});
		t2.test("unassigns when a pending start fails", async t3 => {
			const { host, assign } = testHost(t3);
			assign(7);
			t3.intercept(Instance, "fromConfig", { value: async () => { throw new Error("download failed"); } });
			const connecting = host._connectInstance(7);
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			await t3.rejects(connecting, new Error("download failed"));
			await unassigned;
			t3.equal(host.assignedInstances.has(7), false);
		});
		t2.test("stops an instance still preparing to start", async t3 => {
			const { host, assign, connect } = testHost(t3);
			assign(7);
			const { stop, finish } = await startHeld(t3, await connect(7));
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			await finish();
			await unassigned;
			t3.equal(stop().length, 1);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		for (const status of ["creating_save", "exporting_data"] as const) {
			t2.test(`stops an instance once ${status} finishes`, async t3 => {
				const { host, assign, connect } = testHost(t3);
				assign(7);
				const made = await connect(7);
				const stop = stubStart(t3, made);
				made.server._state = "running";
				made.instance.notifyStatus(status);
				const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
				await tick();
				t3.equal(host.assignedInstances.has(7), true, "waits for the status to settle");
				made.instance.notifyStatus("running");
				await unassigned;
				t3.equal(stop().length, 1);
				t3.equal(host.assignedInstances.has(7), false);
			});
		}
	});

	t1.test("shutdown()", async t2 => {
		t2.test("stops an instance shut down while preparing to start", async t3 => {
			const { host, assign, connect } = testHost(t3);
			assign(7);
			const { stop, finish } = await startHeld(t3, await connect(7));
			const shutdown = host.shutdown();
			await finish();
			await shutdown;
			t3.equal(stop().length, 1);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		t2.test("waits for pending starts and stops running instances", async t3 => {
			const { host, assign, connect, holdStarts, instances } = testHost(t3);
			assign(7);
			assign(8);
			const running = await connect(7);
			const stopRunning = stubStart(t3, running);
			await running.instance._startSave();
			const release = holdStarts();
			const connecting = host._connectInstance(8);
			await tick();
			const shutdown = host.shutdown();
			await tick();
			t3.equal(stopRunning().length, 1);
			release();
			await connecting;
			const pending = instances.get(8)!;
			const stopPending = stubStart(t3, pending);
			await pending.instance._startSave();
			await shutdown;
			t3.equal(stopPending().length, 1);
		});
		t2.test("does not wait on a pending start that fails", async t3 => {
			const { host, assign } = testHost(t3);
			assign(7);
			t3.intercept(Instance, "fromConfig", { value: async () => { throw new Error("download failed"); } });
			const connecting = host._connectInstance(7);
			await host.shutdown();
			await t3.rejects(connecting, new Error("download failed"));
		});
		t2.test("logs an error stopping an instance and stops the rest", async t3 => {
			const { host, assign, connect } = testHost(t3);
			assign(7);
			assign(8);
			const failing = await connect(7);
			stubStart(t3, failing);
			await failing.instance._startSave();
			const other = await connect(8);
			const stopOther = stubStart(t3, other);
			await other.instance._startSave();
			t3.intercept(failing.server, "stop", { value: async () => { throw new Error("stop failed"); } });
			const errors = t3.capture(lib.logger, "error");
			await host.shutdown();
			t3.match(errors.args(), [[/^Unexpected error stopping instance:\nError: stop failed/, { instance_id: 7 }]]);
			t3.equal(stopOther().length, 1);
		});
		t2.test("returns at once when already shutting down", async t3 => {
			const { host, assign, connect } = testHost(t3);
			assign(7);
			const made = await connect(7);
			const stop = stubStart(t3, made);
			await made.instance._startSave();
			host._shuttingDown = true;
			await host.shutdown();
			t3.equal(stop().length, 0);
		});
	});
});
