import assert from "node:assert/strict";
import events from "node:events";

import * as lib from "@clusterio/lib";
import { Controller, ControlConnection } from "@clusterio/controller";

import { testRoundTripJsonSerialisable } from "../common.js";

describe("messages/note", function() {
	/** @type {Controller} */
	let controller;
	/** @type {ControlConnection} */
	let controlConnection;
	let broadcasts;

	beforeEach(function() {
		const controllerConfig = new lib.ControllerConfig("controller");
		const connection = new lib.VirtualConnector(
			lib.Address.fromShorthand("controller"),
			lib.Address.fromShorthand({ controlId: 1 }),
		);
		controller = new Controller(lib.logger, [], controllerConfig);
		broadcasts = [];
		controller.subscriptions.broadcast = event => {
			if (event instanceof lib.NoteUpdatesEvent) {
				broadcasts.push(event);
			}
		};
		const user = controller.users.getOrCreateUser("test");
		controlConnection = new ControlConnection({ version: "2.0.0" }, connection, controller, user, 1);
	});

	describe("NoteSetRequest", function() {
		it("round trips", function() {
			testRoundTripJsonSerialisable(lib.NoteSetRequest, [["host", "1", "text"]]);
		});
		it("creates a note attributed to the requesting user", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			const note = controller.notes.get("host/1");
			assert.equal(note.content, "text");
			assert.equal(note.updatedBy, "test");
			assert(note.updatedAtMs > 0);
			assert.equal(broadcasts.length, 1);
			assert.deepEqual(broadcasts[0].updates, [note]);
		});
		it("updates an existing note in place", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "first"));
			const first = controller.notes.get("host/1").updatedAtMs;
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "second"));
			assert.equal(controller.notes.size, 1);
			const note = controller.notes.get("host/1");
			assert.equal(note.content, "second");
			assert(note.updatedAtMs > first);
		});
		it("leaves a tombstone when content is empty", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			const note = controller.notes.get("host/1");
			assert.equal(note.isDeleted, true);
			assert.equal(note.content, "");
			assert.equal(broadcasts.length, 2);
			assert.equal(broadcasts[1].updates[0].isDeleted, true);
		});
		it("restores a deleted note", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "again"));
			const note = controller.notes.get("host/1");
			assert.equal(note.isDeleted, false);
			assert.equal(note.content, "again");
		});
		it("ignores empty content for a deleted note", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			assert.equal(broadcasts.length, 2);
		});
		it("ignores empty content for a resource without a note", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			assert.equal(controller.notes.size, 0);
			assert.equal(broadcasts.length, 0);
		});
		it("rejects an empty resource type or id", async function() {
			await assert.rejects(
				controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("", "1", "text")),
				new lib.RequestError("resourceType and resourceId must not be empty"),
			);
			await assert.rejects(
				controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "", "text")),
				new lib.RequestError("resourceType and resourceId must not be empty"),
			);
		});
	});

	describe("NoteListRequest", function() {
		it("returns all notes", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "a"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("user", "player", "b"));
			const notes = await controlConnection.handleNoteListRequest();
			assert.deepEqual(notes.map(n => n.id).sort(), ["host/1", "user/player"]);
		});
		it("leaves out deleted notes", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "a"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			assert.deepEqual(await controlConnection.handleNoteListRequest(), []);
		});
	});

	describe("NoteUpdatesEvent", function() {
		it("round trips", function() {
			testRoundTripJsonSerialisable(lib.NoteUpdatesEvent, [
				[[]],
				[[new lib.Note("host", "1", "text", "admin", 1234)]],
			]);
		});
		it("only returns notes changed since the last request on subscribe", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "a"));
			const firstMs = controller.notes.get("host/1").updatedAtMs;
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "2", "b"));

			const all = await controller.handleNoteSubscription({ action: "subscribe", lastRequestTimeMs: 0 });
			assert.equal(all.updates.length, 2);
			const recent = await controller.handleNoteSubscription({
				action: "subscribe", lastRequestTimeMs: firstMs,
			});
			assert.deepEqual(recent.updates.map(n => n.id), ["host/2"]);
			const none = await controller.handleNoteSubscription({ action: "unsubscribe", lastRequestTimeMs: 0 });
			assert.equal(none, null);
		});
		it("replays deletions only to clients that may have the note", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "a"));
			const createdMs = controller.notes.get("host/1").updatedAtMs;
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));

			const fresh = await controller.handleNoteSubscription({ action: "subscribe", lastRequestTimeMs: -1 });
			assert.equal(fresh, null);
			const resumed = await controller.handleNoteSubscription({
				action: "subscribe", lastRequestTimeMs: createdMs,
			});
			assert.deepEqual(resumed.updates.map(n => [n.id, n.isDeleted]), [["host/1", true]]);
		});
		it("removes a note deleted while a subscriber was unsubscribed", async function() {
			let deliver;
			const link = { sendTo: (address, event) => { deliver(event); } };
			const control = {
				connector: Object.assign(new events.EventEmitter(), { valid: true }),
				handle(Event, handler) { deliver = handler; },
				sendTo: (dst, request) => controller.subscriptions.handleRequest(
					link, request, lib.Address.fromShorthand({ controlId: 2 }), lib.Address.fromShorthand("controller"),
				),
			};
			const subscriber = new lib.MapSubscriber(lib.NoteUpdatesEvent, control);
			const tick = () => new Promise(resolve => setImmediate(resolve));

			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			let unsubscribe = subscriber.subscribe(() => {});
			await tick();
			assert.equal(subscriber.values.get("host/1").content, "text");

			unsubscribe();
			await tick();
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));

			unsubscribe = subscriber.subscribe(() => {});
			await tick();
			assert.equal(subscriber.synced, true);
			assert.equal(subscriber.values.has("host/1"), false);
			unsubscribe();
		});
	});

	describe("resource deletion", function() {
		it("does nothing for a resource without a note", function() {
			controller.deleteNote("host", 1);
			assert.equal(broadcasts.length, 0);
		});
		it("removes the note of a deleted role", async function() {
			const id = await controlConnection.handleRoleCreateRequest(new lib.RoleCreateRequest("r", "", []));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("role", String(id), "text"));
			await controlConnection.handleRoleDeleteRequest(new lib.RoleDeleteRequest(id));
			assert.equal(controller.notes.get(`role/${id}`).isDeleted, true);
		});
		it("removes the note of a deleted user", async function() {
			controller.users.getOrCreateUser("Player");
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("user", "player", "text"));
			controller.sendTo = () => {};
			await controlConnection.handleUserDeleteRequest(new lib.UserDeleteRequest("Player"));
			assert.equal(controller.notes.get("user/player").isDeleted, true);
		});
		it("removes the note of a deleted instance", async function() {
			const instanceConfig = new lib.InstanceConfig("controller");
			await controller.instances.createInstance(instanceConfig);
			const id = instanceConfig.get("instance.id");
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("instance", String(id), "text"));
			await controlConnection.handleInstanceDeleteRequest(new lib.InstanceDeleteRequest(id));
			assert.equal(controller.notes.get(`instance/${id}`).isDeleted, true);
		});
	});
});
