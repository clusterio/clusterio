import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import loadInstancePlugin from "../dist/node/instance.js";
import { plugin as info } from "../dist/node/index.js";
import {
	ContributionEvent, FinishedEvent, QueueEvent, QueueSyncRequest, QueueUpdateEvent, SyncTechnologiesRequest,
	TechnologySync,
} from "../dist/node/messages.js";

describe("research_sync instance", function() {
	let instance, host, sent;
	const clusterQueue = ["a", "b"];

	before(function() {
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});
	beforeEach(async function() {
		({ instance, host } = await mock.loadInstancePlugin(loadInstancePlugin, info));
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
			instance.server.rconCommandResults.set("/sc research_sync.dump_technologies()", "[]");
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
		it("should sync technologies before the queue on a new session", async function() {
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.ok(sent[0] instanceof SyncTechnologiesRequest);
			assert.ok(sent[1] instanceof QueueSyncRequest);
		});
		it("should apply research finished elsewhere during the outage", async function() {
			instance.server.rconCommandResults.set(
				"/sc research_sync.dump_technologies()",
				JSON.stringify([{ name: "automation", level: 1, progress: 0.5, researched: false }]),
			);
			let controllerTechs = [new TechnologySync("automation", 1, null, true)];
			let sendTo = instance.sendTo;
			instance.sendTo = async (dst, message) => {
				if (message instanceof SyncTechnologiesRequest) {
					sent.push(message);
					return controllerTechs;
				}
				return sendTo(dst, message);
			};
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			let syncRequest = sent.find(m => m instanceof SyncTechnologiesRequest);
			assert.deepEqual(syncRequest.technologies, [new TechnologySync("automation", 1, 0.5, false)]);
			let syncJson = lib.escapeString(JSON.stringify(controllerTechs));
			assert.ok(instance.server.rconCommands.includes(`/sc research_sync.sync_technologies("${syncJson}")`));
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
				if (message instanceof SyncTechnologiesRequest) {
					return [];
				}
				mock.getHandler(instance, QueueEvent)(new QueueEvent(["new"], null, "B"));
				return ["old"];
			};
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.equal(lastCommand(), applyCommand({ queue: ["new"], instance: "B" }));
		});
	});

	describe("controller outage", function() {
		beforeEach(async function() {
			queueState({ follow: false });
			await instance.hooks.start.invoke();
			sent.length = 0;
			host.connector.connected = false;
		});
		const contributions = () => sent.filter(m => m instanceof ContributionEvent);
		const techSyncs = () => sent.filter(m => m instanceof SyncTechnologiesRequest);
		function contribute(name, level, contribution) {
			instance.server.emit("ipc-research_sync:contribution", { name, level, contribution });
		}

		it("should send contributions while connected", async function() {
			host.connector.connected = true;
			contribute("automation", 1, 0.25);
			instance.server.emit("ipc-research_sync:finished", { name: "automation", level: 1 });
			assert.ok(sent[0] instanceof ContributionEvent);
			assert.ok(sent[1] instanceof FinishedEvent);
		});
		it("should sum contributions and send them on a new session", async function() {
			contribute("automation", 1, 0.25);
			contribute("automation", 1, 0.25);
			contribute("logistics", 1, 0.125);
			assert.equal(sent.length, 0);
			host.connector.connected = true;
			await instance.hooks.controllerConnectionEvent.invoke("connect");
			assert.deepEqual(
				contributions().map(m => [m.name, m.level, m.contribution]),
				[["automation", 1, 0.5], ["logistics", 1, 0.125]],
			);
			assert.ok(sent.indexOf(contributions()[1]) < sent.indexOf(techSyncs()[0]));
		});
		it("should keep only contributions to the highest level", async function() {
			contribute("mining-productivity-3", 3, 0.5);
			contribute("mining-productivity-3", 4, 0.25);
			contribute("mining-productivity-3", 3, 0.5);
			host.connector.connected = true;
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.deepEqual(
				contributions().map(m => [m.name, m.level, m.contribution]),
				[["mining-productivity-3", 4, 0.25]],
			);
		});
		it("should send contributions once", async function() {
			contribute("automation", 1, 0.25);
			host.connector.connected = true;
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(contributions().length, 1);
		});
		it("should not sync technologies on resume when nothing finished", async function() {
			contribute("automation", 1, 0.25);
			host.connector.connected = true;
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(techSyncs().length, 0);
		});
		it("should sync technologies on resume when research finished", async function() {
			instance.server.emit("ipc-research_sync:finished", { name: "automation", level: 1 });
			assert.equal(sent.length, 0);
			host.connector.connected = true;
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(techSyncs().length, 1);
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(techSyncs().length, 1);
		});
		it("should retry the technology sync after it fails on resume", async function() {
			instance.server.emit("ipc-research_sync:finished", { name: "automation", level: 1 });
			host.connector.connected = true;
			let sendTo = instance.sendTo;
			instance.sendTo = async () => { throw new Error("gone"); };
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			instance.sendTo = sendTo;
			await instance.hooks.controllerConnectionEvent.invoke("resume");
			assert.equal(techSyncs().length, 1);
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
