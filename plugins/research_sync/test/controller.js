import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import controllerEntrypoint from "../dist/node/controller.js";
import { plugin as info } from "../dist/node/index.js";
import {
	ContributionEvent, FinishedEvent, QueueEvent, QueueSyncRequest, QueueUpdateEvent,
	SyncTechnologiesRequest, TechnologySync,
} from "../dist/node/messages.js";

describe("research_sync controller", function() {
	const databaseDir = path.join("temp", "test", "research_sync");
	let controller, sent;

	before(function() {
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});
	beforeEach(async function() {
		await fs.rm(databaseDir, { recursive: true, force: true });
		await fs.mkdir(databaseDir, { recursive: true });
		controller = await load();
	});

	async function load() {
		const c = await mock.loadControllerPlugin(async (context) => {
			context.controller.mockConfigEntries.set("controller.database_directory", databaseDir);
			await controllerEntrypoint(context);
		}, info);
		sent = [];
		c.sendTo = (dst, message) => { sent.push([dst, message]); };
		c.instances = new Map([[1, { config: { get: () => "rs-1" } }]]);
		return c;
	}

	const src = { id: 1 };
	const update = (queue, player = null) => mock.getHandler(controller, QueueUpdateEvent)(
		new QueueUpdateEvent(queue, player), src
	);
	const sync = (queue = null, player = null) => mock.getHandler(controller, QueueSyncRequest)(
		new QueueSyncRequest(queue, player), src
	);
	const queueEvents = () => sent.filter(([, m]) => m instanceof QueueEvent);

	it("should store and broadcast an update", async function() {
		await update(["a", "b"], "Bob");
		assert.equal(sent.length, 1);
		assert.equal(sent[0][0], "allInstances");
		assert.ok(sent[0][1] instanceof QueueEvent);
		assert.deepEqual(sent[0][1].queue, ["a", "b"]);
		assert.equal(sent[0][1].player, "Bob");
		assert.equal(sent[0][1].instance, "rs-1");
		assert.deepEqual(await sync(), ["a", "b"]);
	});
	it("should not broadcast an unchanged update", async function() {
		await update(["a", "b"]);
		await update(["a", "b"]);
		assert.equal(queueEvents().length, 1);
	});
	it("should broadcast a clear to an empty queue", async function() {
		await update(["a"], "Bob");
		sent.length = 0;
		await update([], null);
		assert.equal(queueEvents().length, 1);
		assert.deepEqual(queueEvents()[0][1].queue, []);
		assert.equal(queueEvents()[0][1].player, null);
		assert.deepEqual(await sync(null, null), []);
	});
	it("should cap the queue at 7", async function() {
		await update(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
		assert.deepEqual(queueEvents()[0][1].queue, ["1", "2", "3", "4", "5", "6", "7"]);
		assert.deepEqual(await sync(), ["1", "2", "3", "4", "5", "6", "7"]);
	});
	it("should seed an empty queue from a sync request", async function() {
		assert.deepEqual(await sync(["x"], "Bob"), ["x"]);
		assert.equal(queueEvents().length, 1);
		assert.deepEqual(queueEvents()[0][1].queue, ["x"]);
		assert.equal(queueEvents()[0][1].player, "Bob");
		assert.equal(queueEvents()[0][1].instance, "rs-1");
	});
	it("should not replace a non-empty queue from a sync request", async function() {
		await update(["a"]);
		sent.length = 0;
		assert.deepEqual(await sync(["x"]), ["a"]);
		assert.equal(sent.length, 0);
		assert.deepEqual(await sync(), ["a"]);
	});
	it("should not broadcast when seeding with an empty queue", async function() {
		assert.deepEqual(await sync([]), []);
		assert.equal(sent.length, 0);
	});

	describe("finished technologies", function() {
		it("should drop one entry when a contribution completes a technology", async function() {
			await update(["m", "m", "x"]);
			await mock.getHandler(controller, ContributionEvent)(new ContributionEvent("m", 3, 1), src);
			assert.deepEqual(await sync(), ["m", "x"]);
		});
		it("should drop one entry per advancing FinishedEvent only", async function() {
			await update(["m", "m", "x"]);
			const finished = mock.getHandler(controller, FinishedEvent);
			await finished(new FinishedEvent("m", 3), src);
			assert.deepEqual(await sync(), ["m", "x"]);
			await finished(new FinishedEvent("m", 3), src);
			assert.deepEqual(await sync(), ["m", "x"]);
		});
		it("should send the queue silently after a completion behind the current research", async function() {
			await update(["automation", "m", "m"]);
			sent.length = 0;
			await mock.getHandler(controller, ContributionEvent)(new ContributionEvent("m", 3, 1), src);
			assert.equal(queueEvents().length, 1);
			assert.deepEqual(queueEvents()[0][1], new QueueEvent(["automation", "m"], null, null));
		});
		it("should send the queue after an advancing FinishedEvent only", async function() {
			await update(["m", "x"]);
			sent.length = 0;
			const finished = mock.getHandler(controller, FinishedEvent);
			await finished(new FinishedEvent("m", 3), src);
			assert.equal(queueEvents().length, 1);
			assert.deepEqual(queueEvents()[0][1], new QueueEvent(["x"], null, null));
			sent.length = 0;
			await finished(new FinishedEvent("m", 3), src);
			assert.equal(queueEvents().length, 0);
		});
		it("should send no queue when the finished technology is not queued", async function() {
			await update(["x"]);
			sent.length = 0;
			await mock.getHandler(controller, FinishedEvent)(new FinishedEvent("m", 3), src);
			await mock.getHandler(controller, ContributionEvent)(new ContributionEvent("n", 3, 1), src);
			assert.equal(queueEvents().length, 0);
		});
		it("should drop an entry finished through a technology sync", async function() {
			await update(["m", "x"]);
			await mock.getHandler(controller, SyncTechnologiesRequest)(
				new SyncTechnologiesRequest([new TechnologySync("m", 1, null, true)]), src
			);
			assert.deepEqual(await sync(), ["x"]);
		});
	});

	describe("technology sync unlocking several levels", function() {
		const syncTech = (name, level, researched) => mock.getHandler(controller, SyncTechnologiesRequest)(
			new SyncTechnologiesRequest([new TechnologySync(name, level, null, researched)]), src
		);
		it("should drop one entry per level unlocked on a known technology", async function() {
			await syncTech("m", 4, true);
			await update(["m", "m", "m", "x"]);
			sent.length = 0;
			await syncTech("m", 7, true);
			assert.deepEqual(await sync(), ["x"]);
			assert.equal(queueEvents().length, 1);
			assert.deepEqual(queueEvents()[0][1], new QueueEvent(["x"], null, null));
		});
		it("should drop one entry per level unlocked on a new technology", async function() {
			await update(["m", "m", "x"]);
			await syncTech("m", 2, true);
			assert.deepEqual(await sync(), ["x"]);
		});
	});

	it("should persist the queue across loads", async function() {
		await update(["a", "b"]);
		await controller.hooks.save.invoke();
		controller = await load();
		assert.deepEqual(await sync(), ["a", "b"]);
	});
});
