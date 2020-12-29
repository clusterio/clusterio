"use strict";
const assert = require("assert").strict;

const libCommand = require("@clusterio/lib/command");
const libErrors = require("@clusterio/lib/errors");
const libLink = require("@clusterio/lib/link");
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
					list: [{ agent: "test", version: "0.1", id: 11, name: "Test Slave", public_address: "1.2.3.4", connected: false }],
				},
			});
		} else if (message.type === "list_instances_request") {
			this.emit("message", {
				seq: 1, type: "list_instances_response",
				data: {
					seq: message.seq,
					list: [{ id: 57, name: "Test Instance", assigned_slave_name: "Test Slave", game_port: 34197, public_address: "1.2.3.4",status: "stopped" }],
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
	libLink.messages.listSlaves.attach(testControl);
	libLink.messages.listInstances.attach(testControl);
	libLink.messages.listRoles.attach(testControl);

	describe("resolveSlave", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await libCommand.resolveSlave(null, "123"), 123);
		});
		it("should resolve a slave name with the master server", async function() {
			assert.equal(await libCommand.resolveSlave(testControl, "Test Slave"), 11);
		});
		it("should throw if slave is not found", async function() {
			await assert.rejects(
				libCommand.resolveSlave(testControl, "invalid"),
				new libErrors.CommandError("No slave named invalid")
			);
		});
	});
	describe("resolveInstance", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await libCommand.resolveInstance(null, "123"), 123);
		});
		it("should resolve an instance name with the master server", async function() {
			assert.equal(await libCommand.resolveInstance(testControl, "Test Instance"), 57);
		});
		it("should throw if instance is not found", async function() {
			await assert.rejects(
				libCommand.resolveInstance(testControl, "invalid"),
				new libErrors.CommandError("No instance named invalid")
			);
		});
	});
	describe("retrieveRole", function() {
		it("should retrieve a role by id from an integer like string", async function() {
			assert.deepEqual(await libCommand.retrieveRole(testControl, "28"), testRole);
		});
		it("should retrieve a role by name from a string", async function() {
			assert.deepEqual(await libCommand.retrieveRole(testControl, "Test Role"), testRole);
		});
		it("should throw if role is not found", async function() {
			await assert.rejects(
				libCommand.retrieveRole(testControl, "invalid"),
				new libErrors.CommandError("No role named invalid")
			);
		});
	});
});
