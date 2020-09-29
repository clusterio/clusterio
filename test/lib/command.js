"use strict";
const assert = require("assert").strict;

const command = require("@clusterio/lib/command");
const errors = require("@clusterio/lib/errors");
const link = require("@clusterio/lib/link");
const mock = require("../mock");


describe("lib/command", function() {
	let testRole = { id: 28, name: "Test Role", description: "Test", permissions: [] };
	let mockConnector = new mock.MockConnector();
	mockConnector.on("send", function(message) {
		if (message.type === "list_slaves_request") {
			this.emit("message", {
				seq: 1, type: "list_slaves_response",
				data: {
					seq: message.seq,
					list: [{ agent: "test", version: "0.1", id: 11, name: "Test Slave", connected: false }],
				},
			});
		} else if (message.type === "list_instances_request") {
			this.emit("message", {
				seq: 1, type: "list_instances_response",
				data: {
					seq: message.seq,
					list: [{ id: 57, assigned_slave: 4, name: "Test Instance", status: "stopped" }],
				},
			});
		} else if (message.type === "list_roles_request") {
			this.emit("message", {
				seq: 1, type: "list_roles_response",
				data: {
					seq: message.seq,
					list: [testRole],
				},
			});
		}
	});

	let testControl = new mock.MockControl(mockConnector);
	link.messages.listSlaves.attach(testControl);
	link.messages.listInstances.attach(testControl);
	link.messages.listRoles.attach(testControl);

	describe("resolveSlave", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await command.resolveSlave(null, "123"), 123);
		});
		it("should resolve a slave name with the master server", async function() {
			assert.equal(await command.resolveSlave(testControl, "Test Slave"), 11);
		});
		it("should throw if slave is not found", async function() {
			await assert.rejects(
				command.resolveSlave(testControl, "invalid"),
				new errors.CommandError("No slave named invalid")
			);
		});
	});
	describe("resolveInstance", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await command.resolveInstance(null, "123"), 123);
		});
		it("should resolve an instance name with the master server", async function() {
			assert.equal(await command.resolveInstance(testControl, "Test Instance"), 57);
		});
		it("should throw if instance is not found", async function() {
			await assert.rejects(
				command.resolveInstance(testControl, "invalid"),
				new errors.CommandError("No instance named invalid")
			);
		});
	});
	describe("retrieveRole", function() {
		it("should retrieve a role by id from an integer like string", async function() {
			assert.deepEqual(await command.retrieveRole(testControl, "28"), testRole);
		});
		it("should retrieve a role by name from a string", async function() {
			assert.deepEqual(await command.retrieveRole(testControl, "Test Role"), testRole);
		});
		it("should throw if role is not found", async function() {
			await assert.rejects(
				command.retrieveRole(testControl, "invalid"),
				new errors.CommandError("No role named invalid")
			);
		});
	});
});
