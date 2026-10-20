import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import loadInstancePlugin from "../dist/node/instance.js";
import { plugin as info } from "../dist/node/index.js";
import {
	QueueEvent, QueueSyncRequest, QueueUpdateEvent, SyncTechnologiesRequest,
} from "../dist/node/messages.js";

describe("research_sync instance", function() {
	let instance, sent;
	const clusterQueue = ["a", "b"];

	before(function() {
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});
	beforeEach(async function() {
		({ instance } = await mock.loadInstancePlugin(loadInstancePlugin, info));
		sent = [];
		instance.sendTo = async (dst, message) => {
			sent.push(message);
			if (message instanceof SyncTechnologiesRequest) {
				return [];
			}
			if (message instanceof QueueSyncRequest) {
				return clusterQueue;
			}
			return undefined;
		};
		instance.server.rconCommandResults.set("/sc research_sync.dump_technologies()", "[]");
	});

	function queueState(state) {
		instance.server.rconCommandResults.set("/sc research_sync.queue_state()", JSON.stringify(state));
	}
	const applyCommand = data => `/sc research_sync.apply_queue("${lib.escapeString(JSON.stringify(data))}")`;
	const lastCommand = () => instance.server.rconCommands[instance.server.rconCommands.length - 1];
	const queueSyncs = () => sent.filter(m => m instanceof QueueSyncRequest);

	describe("start", function() {
		it("should seed the cluster queue on a first start", async function() {
			queueState({ follow: true, first: true, queue: {} });
			await instance.hooks.start.invoke();
			assert.equal(queueSyncs().length, 1);
			assert.deepEqual(queueSyncs()[0].queue, []);
			assert.equal(lastCommand(), applyCommand({ queue: clusterQueue }));
		});
		it("should only fetch the cluster queue after the first start", async function() {
			queueState({ follow: true, first: false });
			await instance.hooks.start.invoke();
			assert.equal(queueSyncs()[0].queue, null);
		});
		it("should not sync the queue when not following", async function() {
			queueState({ follow: false });
			await instance.hooks.start.invoke();
			assert.equal(queueSyncs().length, 0);
		});
	});

	describe("QueueEvent", function() {
		beforeEach(async function() {
			queueState({ follow: false });
			await instance.hooks.start.invoke();
			instance.server.reset();
		});
		const handler = () => mock.getHandler(instance, QueueEvent);

		it("should apply the queue with the player", async function() {
			await handler()(new QueueEvent(["a"], "Bob", "rs-2"));
			assert.equal(lastCommand(), applyCommand({ queue: ["a"], instance: "rs-2", player: "Bob" }));
		});
		it("should leave out a null player", async function() {
			await handler()(new QueueEvent(["a"], null, "rs-2"));
			assert.equal(lastCommand(), applyCommand({ queue: ["a"], instance: "rs-2" }));
		});
		it("should leave out a null instance", async function() {
			await handler()(new QueueEvent(["a"], null, null));
			assert.equal(lastCommand(), applyCommand({ queue: ["a"] }));
		});
		it("should ignore the event while stopped", async function() {
			instance.status = "stopped";
			await handler()(new QueueEvent(["a"], null, "rs-2"));
			assert.equal(instance.server.rconCommands.length, 0);
		});
	});

	describe("controller connection", function() {
		beforeEach(async function() {
			queueState({ follow: true, first: false });
			await instance.hooks.start.invoke();
			sent.length = 0;
			instance.server.reset();
			queueState({ follow: true, first: false });
		});

		it("should fetch the cluster queue again on a new session", async function() {
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.equal(queueSyncs().length, 1);
			assert.equal(queueSyncs()[0].queue, null);
			assert.equal(lastCommand(), applyCommand({ queue: clusterQueue }));
		});
		it("should do nothing on resume", async function() {
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(sent.length, 0);
		});
		it("should do nothing while stopped", async function() {
			instance.status = "stopped";
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.equal(sent.length, 0);
		});
		it("should not throw when the fetch fails", async function() {
			instance.sendTo = async () => { throw new Error("gone"); };
			await instance.hooks.controllerConnectionEvent.invoke("connect");
		});
		it("should not let the reply overwrite a newer QueueEvent delivered with it", async function() {
			// As if the reply and the broadcast came in one socket read: the event is handled before the
			// reply resolves the request's await
			instance.sendTo = async (dst, message) => {
				sent.push(message);
				mock.getHandler(instance, QueueEvent)(new QueueEvent(["new"], null, "B"));
				return ["old"];
			};
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.equal(lastCommand(), applyCommand({ queue: ["new"], instance: "B" }));
		});
	});

	it("should forward queue changes from the game", async function() {
		instance.server.emit("ipc-research_sync:queue", { queue: {}, player: "Bob" });
		assert.equal(sent.length, 1);
		assert.ok(sent[0] instanceof QueueUpdateEvent);
		assert.deepEqual(sent[0].queue, []);
		assert.equal(sent[0].player, "Bob");
	});
});
