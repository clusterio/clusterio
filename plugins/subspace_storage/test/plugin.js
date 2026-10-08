import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import * as mock from "../../../test/mock.js";
import controllerEntrypoint from "../dist/node/controller.js";
import instanceEntrypoint from "../dist/node/instance.js";
import { plugin as info } from "../dist/node/index.js";
import {
	Item, PlaceEvent, RemoveRequest, GetStorageRequest, UpdateStorageEvent,
} from "../dist/node/messages.js";


describe("subspace_storage plugin", function() {
	before(function() {
		try {
			lib.registerPluginMessages([info]);
		} catch (err) {
			// Already registered by the full test suite
		}
	});

	describe("controller entrypoint", function() {
		const databaseDir = path.join("temp", "test", "subspace_storage");
		const src = lib.Address.fromShorthand({ instanceId: 7357 });
		let controller;
		let sent;
		before(async function() {
			await fs.rm(databaseDir, { recursive: true, force: true });
			controller = await mock.loadControllerPlugin(async (context) => {
				context.controller.mockConfigEntries.set("controller.database_directory", databaseDir);
				context.controller.mockConfigEntries.set("subspace_storage.division_method", "simple");
				context.controller.mockConfigEntries.set("subspace_storage.log_item_transfers", false);
				sent = [];
				context.controller.sendTo = (dst, event) => { sent.push(event); };
				await controllerEntrypoint(context);
			}, info);
		});
		after(async function() {
			await controller.hooks.shutdown.invoke();
		});

		it("should store placed items and broadcast the update", async function() {
			await mock.getHandler(controller, PlaceEvent)(
				new PlaceEvent([new Item("iron-plate", 20, "normal")]), src
			);
			const storage = await mock.getHandler(controller, GetStorageRequest)();
			assert.deepEqual(storage, [new Item("iron-plate", 20, "normal")]);
			assert(sent[0] instanceof UpdateStorageEvent);
		});
		it("should remove requested items up to the stored amount", async function() {
			const removed = await mock.getHandler(controller, RemoveRequest)(
				new RemoveRequest([new Item("iron-plate", 15, "normal"), new Item("copper-plate", 5, "normal")]), src
			);
			assert.deepEqual(removed, [new Item("iron-plate", 15, "normal")]);
		});
		it("should update the inventory gauge on metrics", async function() {
			for (const result of await controller.hooks.metrics.collect()) {
				for await (const _ of result) { /* drain */ }
			}
			const gauge = lib.defaultRegistry.collectors.find(
				collector => collector.metric?.name === "clusterio_subspace_storage_controller_inventory"
			);
			assert.equal(gauge.labels("iron-plate", "normal").get(), 5);
		});
		it("should save the item database", async function() {
			await controller.hooks.save.invoke();
			const content = JSON.parse(await fs.readFile(path.join(databaseDir, "items.json"), "utf8"));
			assert.deepEqual(content, { "iron-plate": { normal: 5 } });
		});
	});

	describe("instance entrypoint", function() {
		let instance;
		before(async function() {
			({ instance } = await mock.loadInstancePlugin(instanceEntrypoint, info));
			instance.mockConfigEntries.set("subspace_storage.log_item_transfers", false);
		});

		it("should send output items to the controller", async function() {
			instance.server.emit("ipc-subspace_storage:output", [["iron-plate", 10, "normal"]]);
			await new Promise(resolve => setImmediate(resolve));
			const message = instance.connector.sentMessages.find(m => m.data instanceof PlaceEvent);
			assert(message, "PlaceEvent was not sent");
		});
		it("should ignore orders while not running", async function() {
			instance.status = "starting";
			instance.server.emit("ipc-subspace_storage:orders", [["iron-plate", 10, "normal"]]);
			await new Promise(resolve => setImmediate(resolve));
			const message = instance.connector.sentMessages.find(m => m.data instanceof RemoveRequest);
			assert.equal(message, undefined);
		});
	});
});
