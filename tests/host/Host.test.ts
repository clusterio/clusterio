import events from "node:events";
import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";
import { Host, Instance } from "@clusterio/host";
import { HostConnector } from "@clusterio/host/dist/node/host.js";

const tick = () => new Promise(resolve => setImmediate(resolve));

/**
 * Host with instances 7 and 8 assigned, and Instance.fromConfig replaced by
 * a start that waits for release() and makes an instance with a fake server.
 */
function setup(tt: Test) {
	const dir = tt.testdir();
	const hostConfig = new lib.HostConfig("host");
	const host = new Host(new HostConnector(hostConfig, []), hostConfig, []);
	tt.capture(host, "send");
	tt.capture(host.connector, "forward");
	for (const id of [7, 8]) {
		const config = new lib.InstanceConfig("host", { "instance.id": id, "instance.name": `i${id}` });
		host.assignedInstances.set(id, { path: dir, config });
	}

	const stops: number[] = [];
	const releases: (() => void)[] = [];
	tt.capture(Instance, "fromConfig", async (config, fromHost, connector) => {
		await new Promise<void>(resolve => releases.push(resolve));
		const server: any = new events.EventEmitter();
		server._state = "init";
		const instance = new Instance(fromHost, connector, dir, config, server);
		instance._status = "starting";
		tt.capture(instance, "writeServerSettings");
		tt.capture(instance, "sendSaveListUpdate");
		tt.capture(instance, "prepare");
		tt.capture(instance, "prepareSave", async () => "save.zip");
		tt.capture(instance, "start", async () => {
			server._state = "running";
			instance.notifyStatus("running");
		});
		server.stop = async () => {
			stops.push(instance.id);
			instance.notifyExit();
		};
		return instance;
	});

	/** Let the oldest pending fromConfig finish */
	const release = () => releases.shift()!();
	async function connect(id: number) {
		const connecting = host._connectInstance(id);
		await tick();
		release();
		return (await connecting).instance;
	}
	/** Start an instance and hold it in prepare until the returned function is called */
	async function startHeld(id: number) {
		const instance = await connect(id);
		let finishPrepare!: () => void;
		tt.capture(instance, "prepare", () => new Promise<void>(resolve => { finishPrepare = resolve; }));
		const started = instance._startSave();
		await tick();
		return async () => {
			finishPrepare();
			await started;
		};
	}
	return { host, stops, release, connect, startHeld };
}

const unassign = (id: number) => new lib.InstanceUnassignInternalRequest(id);

t.test("Host", async t1 => {
	t1.test("instanceStatus()", async t2 => {
		t2.test("is stopped for an instance that is not connected", async t3 => {
			const { host } = setup(t3);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		t2.test("is starting while waiting on fromConfig", async t3 => {
			const { host, release } = setup(t3);
			const connecting = host._connectInstance(7);
			await tick();
			t3.equal(host.instanceStatus(7), "starting");
			release();
			await connecting;
		});
		t2.test("is the status of a connected instance", async t3 => {
			const { host, connect } = setup(t3);
			const instance = await connect(7);
			instance.notifyStatus("exporting_data");
			t3.equal(host.instanceStatus(7), "exporting_data");
		});
	});

	t1.test("_connectInstance()", async t2 => {
		t2.test("rejects while the host is shutting down", async t3 => {
			const { host } = setup(t3);
			host._shuttingDown = true;
			await t3.rejects(host._connectInstance(7), new lib.UnavailableError("Host is shutting down"));
		});
		t2.test("rejects a second start while the first waits on fromConfig", async t3 => {
			const { host, release } = setup(t3);
			const first = host._connectInstance(7);
			await t3.rejects(host._connectInstance(7), new lib.ConflictError("Instance with ID 7 is running"));
			await tick();
			release();
			await first;
		});
	});

	t1.test("handleInstanceUnassignInternalRequest()", async t2 => {
		t2.test("unassigns a stopped instance", async t3 => {
			const { host, stops } = setup(t3);
			await host.handleInstanceUnassignInternalRequest(unassign(7));
			t3.equal(host.assignedInstances.has(7), false);
			t3.same(stops, []);
		});
		t2.test("stops an instance once a pending start connects and runs", async t3 => {
			const { host, stops, release } = setup(t3);
			const connecting = host._connectInstance(7);
			await tick();
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			release();
			const { instance } = await connecting;
			await instance._startSave();
			await unassigned;
			t3.same(stops, [7]);
			t3.equal(instance.status, "stopped");
			t3.equal(host.assignedInstances.has(7), false);
		});
		t2.test("unassigns when a pending start fails", async t3 => {
			const { host } = setup(t3);
			t3.capture(Instance, "fromConfig", async () => { throw new Error("download failed"); });
			const connecting = host._connectInstance(7);
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			await t3.rejects(connecting, new Error("download failed"));
			await unassigned;
			t3.equal(host.assignedInstances.has(7), false);
		});
		t2.test("stops an instance still preparing to start", async t3 => {
			const { host, stops, startHeld } = setup(t3);
			const finish = await startHeld(7);
			const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
			await finish();
			await unassigned;
			t3.same(stops, [7]);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		for (const status of ["creating_save", "exporting_data"] as const) {
			t2.test(`stops an instance once ${status} finishes`, async t3 => {
				const { host, stops, connect } = setup(t3);
				const instance = await connect(7);
				(instance.server as any)._state = "running";
				instance.notifyStatus(status);
				const unassigned = host.handleInstanceUnassignInternalRequest(unassign(7));
				await tick();
				t3.equal(host.assignedInstances.has(7), true, "waits for the status to settle");
				instance.notifyStatus("running");
				await unassigned;
				t3.same(stops, [7]);
				t3.equal(host.assignedInstances.has(7), false);
			});
		}
	});

	t1.test("shutdown()", async t2 => {
		t2.test("stops an instance shut down while preparing to start", async t3 => {
			const { host, stops, startHeld } = setup(t3);
			const finish = await startHeld(7);
			const shutdown = host.shutdown();
			await finish();
			await shutdown;
			t3.same(stops, [7]);
			t3.equal(host.instanceStatus(7), "stopped");
		});
		t2.test("waits for pending starts and stops running instances", async t3 => {
			const { host, stops, connect, release } = setup(t3);
			await (await connect(7))._startSave();
			const connecting = host._connectInstance(8);
			await tick();
			const shutdown = host.shutdown();
			await tick();
			t3.same(stops, [7]);
			release();
			await (await connecting).instance._startSave();
			await shutdown;
			t3.same(stops, [7, 8]);
		});
		t2.test("does not wait on a pending start that fails", async t3 => {
			const { host, stops } = setup(t3);
			t3.capture(Instance, "fromConfig", async () => { throw new Error("download failed"); });
			const connecting = host._connectInstance(7);
			await host.shutdown();
			await t3.rejects(connecting, new Error("download failed"));
			t3.same(stops, []);
		});
		t2.test("logs an error stopping an instance and stops the rest", async t3 => {
			const { host, stops, connect } = setup(t3);
			const failing = await connect(7);
			await failing._startSave();
			await (await connect(8))._startSave();
			(failing.server as any).stop = async () => { throw new Error("stop failed"); };
			const errors = t3.capture(lib.logger, "error");
			await host.shutdown();
			t3.match(errors.args(), [[/^Unexpected error stopping instance:\nError: stop failed/, { instance_id: 7 }]]);
			t3.same(stops, [8]);
		});
		t2.test("returns at once when already shutting down", async t3 => {
			const { host, stops, connect } = setup(t3);
			await (await connect(7))._startSave();
			host._shuttingDown = true;
			await host.shutdown();
			t3.same(stops, []);
		});
	});
});
