"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");
const mock = require("../mock");

const addr = lib.Address.fromShorthand;


describe("lib/command", function() {
	let testRole = lib.Role.fromJSON({ id: 28, name: "Test Role", description: "Test", permissions: [] });

	let [controlConnector, controllerConnector] = lib.VirtualConnector.makePair(
		addr({ controlId: 1}), addr("controller")
	);
	let testControl = new mock.MockControl(controlConnector);
	let testController = new lib.Link(controllerConnector);
	testController.handle(
		lib.HostListRequest, () => [new lib.HostDetails("test", "0.1", "Test Host", 11, false)]
	);
	testController.handle(
		lib.InstanceDetailsListRequest, () => [new lib.InstanceDetails("Test Instance", 57, 4, undefined, "stopped")]
	);
	testController.handle(lib.RoleListRequest, () => [testRole.toJSON()]);

	describe("resolveHost", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await lib.resolveHost(null, "123"), 123);
		});
		it("should resolve a host name with the controller", async function() {
			assert.equal(await lib.resolveHost(testControl, "Test Host"), 11);
		});
		it("should throw if host is not found", async function() {
			await assert.rejects(
				lib.resolveHost(testControl, "invalid"),
				new lib.CommandError("No host named invalid")
			);
		});
	});
	describe("resolveInstance", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await lib.resolveInstance(null, "123"), 123);
		});
		it("should resolve an instance name with the controller", async function() {
			assert.equal(await lib.resolveInstance(testControl, "Test Instance"), 57);
		});
		it("should throw if instance is not found", async function() {
			await assert.rejects(
				lib.resolveInstance(testControl, "invalid"),
				new lib.CommandError("No instance named invalid")
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
		it("should throw if role is not found", async function() {
			await assert.rejects(
				lib.retrieveRole(testControl, "invalid"),
				new lib.CommandError("No role named invalid")
			);
		});
	});
});
