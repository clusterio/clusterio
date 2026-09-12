import assert from "node:assert/strict";

import * as lib from "@clusterio/lib";
import * as mock from "../mock.js";

const addr = lib.Address.fromShorthand;


describe("lib/command", function() {
	let testRole = lib.Role.fromJSON({ id: 28, name: "Test Role", description: "Test", permissions: [] });

	let [controlConnector, controllerConnector] = lib.VirtualConnector.makePair(
		addr({ controlId: 1}), addr("controller")
	);
	let testControl = new mock.MockControl(controlConnector);
	let testController = new lib.Link(controllerConnector);
	testController.handle(
		lib.HostListRequest, () => [
			new lib.HostDetails("0.1", "Test Host", 11, false),
			new lib.HostDetails("0.1", "22", 12, false),
			new lib.HostDetails("0.1", "12", 13, false),
		]
	);
	testController.handle(
		lib.InstanceDetailsListRequest, () => [
			new lib.InstanceDetails("Test Instance", 57, 4, undefined, "stopped"),
			new lib.InstanceDetails("10", 58, 4, undefined, "stopped"),
			new lib.InstanceDetails("58", 59, 4, undefined, "stopped"),
		]
	);
	let numericRole = lib.Role.fromJSON({ id: 29, name: "77", description: "Test", permissions: [] });
	testController.handle(lib.RoleListRequest, () => [testRole.toJSON(), numericRole.toJSON()]);

	describe("resolveHost", function() {
		it("should resolve an integer like string as an id", async function() {
			assert.equal(await lib.resolveHost(testControl, "11"), 11);
		});
		it("should resolve a host name with the controller", async function() {
			assert.equal(await lib.resolveHost(testControl, "Test Host"), 11);
		});
		it("should resolve an integer like name if no host has that id", async function() {
			assert.equal(await lib.resolveHost(testControl, "22"), 12);
		});
		it("should prefer the id over an integer like name", async function() {
			assert.equal(await lib.resolveHost(testControl, "12"), 12);
		});
		it("should throw if host is not found", async function() {
			await assert.rejects(
				lib.resolveHost(testControl, "invalid"),
				new lib.CommandError("No host named invalid")
			);
			await assert.rejects(
				lib.resolveHost(testControl, "123"),
				new lib.CommandError("No host named 123")
			);
		});
	});
	describe("resolveInstance", function() {
		it("should resolve an integer like string as an id", async function() {
			assert.equal(await lib.resolveInstance(testControl, "57"), 57);
		});
		it("should resolve an instance name with the controller", async function() {
			assert.equal(await lib.resolveInstance(testControl, "Test Instance"), 57);
		});
		it("should resolve an integer like name if no instance has that id", async function() {
			assert.equal(await lib.resolveInstance(testControl, "10"), 58);
		});
		it("should prefer the id over an integer like name", async function() {
			assert.equal(await lib.resolveInstance(testControl, "58"), 58);
		});
		it("should throw if instance is not found", async function() {
			await assert.rejects(
				lib.resolveInstance(testControl, "invalid"),
				new lib.CommandError("No instance named invalid")
			);
			await assert.rejects(
				lib.resolveInstance(testControl, "123"),
				new lib.CommandError("No instance named 123")
			);
		});
	});
	describe("retrieveRole", function() {
		it("should retrieve a role by id from an integer like string", async function() {
			assert.deepEqual(await lib.retrieveRole(testControl, "28"), testRole);
		});
		it("should retrieve a role by name from a string", async function() {
			assert.deepEqual(await lib.retrieveRole(testControl, "Test Role"), testRole);
		});
		it("should retrieve a role by an integer like name if no role has that id", async function() {
			assert.deepEqual(await lib.retrieveRole(testControl, "28"), testRole);
			assert.deepEqual(await lib.retrieveRole(testControl, "77"), numericRole);
		});
		it("should throw if role is not found", async function() {
			await assert.rejects(
				lib.retrieveRole(testControl, "invalid"),
				new lib.CommandError("No role named invalid")
			);
		});
	});
});
