"use strict";
const assert = require("assert").strict;

const libCommand = require("@clusterio/lib/command");
const libData = require("@clusterio/lib/data");
const libErrors = require("@clusterio/lib/errors");
const libLink = require("@clusterio/lib/link");
const mock = require("../mock");

const addr = libData.Address.fromShorthand;


describe("lib/command", function() {
	let testRole = libData.RawRole.fromJSON({ id: 28, name: "Test Role", description: "Test", permissions: [] });

	let loopbackConnector = new libLink.VirtualConnector(addr("controller"), addr("controller"));
	let testControl = new mock.MockControl(loopbackConnector);
	testControl.register(
		libData.HostListRequest, () => [new libData.HostDetails("test", "0.1", "Test Host", 11, false)]
	);
	testControl.register(
		libData.InstanceDetailsListRequest, () => [new libData.InstanceDetails("Test Instance", 57, 4, null, "stopped")]
	);
	testControl.register(libData.RoleListRequest, () => [testRole]);

	describe("resolveHost", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await libCommand.resolveHost(null, "123"), 123);
		});
		it("should resolve a host name with the controller", async function() {
			assert.equal(await libCommand.resolveHost(testControl, "Test Host"), 11);
		});
		it("should throw if host is not found", async function() {
			await assert.rejects(
				libCommand.resolveHost(testControl, "invalid"),
				new libErrors.CommandError("No host named invalid")
			);
		});
	});
	describe("resolveInstance", function() {
		it("should pass an integer like string back", async function() {
			assert.equal(await libCommand.resolveInstance(null, "123"), 123);
		});
		it("should resolve an instance name with the controller", async function() {
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
