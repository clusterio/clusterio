import t from "tap";
import * as lib from "@clusterio/lib";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import { addr } from "../shared/link.ts";

/** Instance with a real FactorioServer that has not spawned Factorio */
function testInstance(dir: string) {
	const config = new lib.InstanceConfig("host");
	config.set("instance.name", "test");
	const src = addr({ instanceId: config.get("instance.id") });
	const [connector, peer] = lib.VirtualConnector.makePair(src, addr({ hostId: 1 }));
	const statuses: string[] = [];
	peer.on("message", message => {
		if (message.type === "event" && message.name === lib.InstanceStatusChangedEvent.name) {
			statuses.push(message.data.status);
		}
	});
	const server = new FactorioServer(dir, dir, dir, "2.0.0", {
		rconPassword: "test",
		enableLuaUdp: true,
	});
	const instance = new Instance({ _crashRetryAttempts: new Map() } as any, connector, dir, config, server);
	return { instance, server, statuses };
}

t.test("Instance", async t1 => {
	t1.test("_startSave()", async t2 => {
		t2.test("stops when the server throws before spawning Factorio", async t3 => {
			const { instance, server, statuses } = testInstance(t3.testdir());
			t3.intercept(instance, "prepare", { value: async () => {} });
			t3.intercept(instance, "prepareSave", { value: async () => "save.zip" });
			t3.intercept(instance, "writeServerSettings", { value: async () => ({}) });
			t3.intercept(instance, "_saveStats", { value: async () => {} });
			t3.capture(instance.logger, "verbose");
			const errors = t3.capture(instance.logger, "error");
			instance.notifyStatus("starting");
			await t3.rejects(instance._startSave(), new Error("Lua UDP requires Factorio 2.1.10 or later"));
			t3.equal(server._state, "init");
			t3.equal(instance.status, "stopped");
			t3.same(statuses, ["starting", "stopping", "stopped"]);
			t3.same(errors.args(), [["Error starting save.zip: Lua UDP requires Factorio 2.1.10 or later"]]);
		});
	});
});
