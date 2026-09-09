"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { Controller, ControlConnection } = require("@clusterio/controller");
const { testRoundTripJsonSerialisable } = require("../common");

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
		it("removes the note when content is empty", async function() {
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", "text"));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("host", "1", ""));
			assert.equal(controller.notes.has("host/1"), false);
			assert.equal(broadcasts.length, 2);
			assert.equal(broadcasts[1].updates[0].isDeleted, true);
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
	});

	describe("resource deletion", function() {
		it("removes the note of a deleted role", async function() {
			const id = await controlConnection.handleRoleCreateRequest(new lib.RoleCreateRequest("r", "", []));
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("role", String(id), "text"));
			await controlConnection.handleRoleDeleteRequest(new lib.RoleDeleteRequest(id));
			assert.equal(controller.notes.has(`role/${id}`), false);
		});
		it("removes the note of a deleted user", async function() {
			controller.users.getOrCreateUser("Player");
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("user", "player", "text"));
			controller.sendTo = () => {};
			await controlConnection.handleUserDeleteRequest(new lib.UserDeleteRequest("Player"));
			assert.equal(controller.notes.has("user/player"), false);
		});
		it("removes the note of a deleted instance", async function() {
			const instanceConfig = new lib.InstanceConfig("controller");
			await controller.instances.createInstance(instanceConfig);
			const id = instanceConfig.get("instance.id");
			await controlConnection.handleNoteSetRequest(new lib.NoteSetRequest("instance", String(id), "text"));
			await controlConnection.handleInstanceDeleteRequest(new lib.InstanceDeleteRequest(id));
			assert.equal(controller.notes.has(`instance/${id}`), false);
		});
	});
});
