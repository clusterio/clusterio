import t from "tap";
import { testInstance } from "../shared/instance.ts";

t.test("Instance", async t1 => {
	t1.test("_startSave()", async t2 => {
		t2.test("stops when the server throws before spawning Factorio", async t3 => {
			const { instance, server, statuses, logs } = testInstance(t3);
			t3.intercept(instance, "prepare", { value: async () => {} });
			t3.intercept(instance, "prepareSave", { value: async () => "save.zip" });
			t3.intercept(instance, "writeServerSettings", { value: async () => ({}) });
			t3.intercept(server, "start", { value: async () => { throw new Error("start failed"); } });
			instance.notifyStatus("starting");
			await t3.rejects(instance._startSave(), new Error("start failed"));
			t3.equal(server._state, "init");
			t3.equal(instance.status, "stopped");
			t3.same(statuses(), ["starting", "stopping", "stopped"]);
			t3.same(logs.error.args(), [["Error starting save.zip: start failed"]]);
		});
	});
	t1.test("stop()", async t2 => {
		t2.test("stops the server when running", async t3 => {
			const { instance, server, statuses } = testInstance(t3);
			const stop = t3.intercept(server, "stop", { value: async () => { server._state = "stopping"; } });
			t3.intercept(instance, "sendSaveListUpdate", { value: async () => {} });
			server._state = "running";
			instance.notifyStatus("running");
			await instance.stop();
			t3.equal(stop().length, 1);
			t3.equal(instance.status, "stopping", "stopped once the process exits");
			t3.same(statuses(), ["running", "stopping"]);
		});
		t2.test("finishes the stop when the server never started", async t3 => {
			const { instance, statuses } = testInstance(t3);
			instance.notifyStatus("starting");
			await instance.stop();
			t3.equal(instance.status, "stopped");
			t3.same(statuses(), ["starting", "stopping", "stopped"]);
		});
		t2.test("does nothing when stopped", async t3 => {
			const { instance, statuses } = testInstance(t3);
			instance.notifyStatus("stopped");
			await instance.stop();
			t3.same(statuses(), ["stopped"]);
		});
	});
});
