"use strict";
const assert = require("assert").strict;
const { Controller, HostInfo, InstanceInfo } = require("@clusterio/controller");
const { ControllerConfig, Address, RequestError, InstanceConfig, SystemInfo, Role } = require("@clusterio/lib");
const { EventEmitter } = require("stream");

class MockEvent {}

class MockInstanceConfig extends EventEmitter {
	constructor(data = new Map()) {
		super();
		this._data = data;
	}

	get(field) {
		return this._data.get(field);
	}

	set(field, value) {
		const prev = this.get(field);
		this._data.set(field, value);
		this.emit("fieldChanged", field, value, prev);
	}
}

describe("controller/src/Controller", function() {
	describe("class Controller", function() {
		/** @type {Controller} */
		let controller, mockInstanceConfig;
		before(async function() {
			controller = new Controller({}, [], new ControllerConfig("controller"));
			mockInstanceConfig = new MockInstanceConfig(new Map([
				["instance.id", 100], ["instance.name", "test"], ["factorio.settings", []],
			]));
			await controller.instanceCreate(mockInstanceConfig);
		});
		function check(list, ip, present = true) {
			if (present === false) {
				assert(!list.check(ip), `${ip} unexpectedly in list`);
			} else {
				assert(list.check(ip), `${ip} missing from list`);
			}
		}
		describe(".parseTrustedProxies()", function() {
			it("should parse addresses", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1");
				let list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2", false);
				controller.config.set("controller.trusted_proxies", "10.0.0.1, 10.0.0.2, 10.1.2.3");
				list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2");
				check(list, "10.0.0.3", false);
			});
			it("should ignore invalid entries", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1, invalid, 0.0.0.0/200, 10.0.0.2");
				const list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2");
				check(list, "10.0.0.3", false);
			});
			it("should parse CIDR blocks", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1/24, 192.168.0.16/31");
				const list = controller.parseTrustedProxies();
				check(list, "10.0.0.0");
				check(list, "10.0.0.1");
				check(list, "10.0.0.10");
				check(list, "10.0.0.255");
				check(list, "10.0.1.0", false);
				check(list, "192.168.0.15", false);
				check(list, "192.168.0.16");
				check(list, "192.168.0.17");
				check(list, "192.168.0.18", false);
			});
		});

		describe(".sendRequest()", function() {
			it("should error on loopback", function() {
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand("controller")),
					new Error(`Message would return back to sender ${Address.fromShorthand("controller")}.`)
				);
			});
			it("should error on invalid controller", function() {
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand({ controlId: 99 })),
					new RequestError("Target control connection does not exist.")
				);
			});
			it("should error on invalid instance", function() {
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand({ instanceId: 99 })),
					new RequestError("Instance with ID 99 does not exist")
				);
			});
			it("should error on unassigned instance", function() {
				mockInstanceConfig.set("instance.assigned_host", null);
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand({ instanceId: 100 })),
					new RequestError("Instance is not assigned to a host")
				);
			});
			it("should error on instance with disconnected host", function() {
				mockInstanceConfig.set("instance.assigned_host", 99);
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand({ instanceId: 100 })),
					new RequestError("Host containing instance is not connected")
				);
			});
			it("should error on invalid host", function() {
				assert.throws(
					() => controller.sendRequest(new MockEvent(), Address.fromShorthand({ hostId: 99 })),
					new RequestError("Host is not connected")
				);
			});
			it("should error on invalid broadcast", function() {
				// This is different to sendEvent because requests do not support broadcasting
				assert.throws(
					() => controller.sendRequest(new MockEvent(), new Address(Address.broadcast, 99)),
					new Error(`Unknown address type ${Address.broadcast}`)
				);
			});
			it("should error on invalid address", function() {
				assert.throws(
					() => controller.sendRequest(new MockEvent(), new Address(99, 99)),
					new Error("Unknown address type 99")
				);
			});
		});

		describe(".sendEvent()", function() {
			it("should error on loopback", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand("controller")),
					new Error(`Message would return back to sender ${Address.fromShorthand("controller")}.`)
				);
			});
			it("should error on invalid controller", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand({ controlId: 99 })),
					new Error("Target control connection does not exist.")
				);
			});
			it("should error on invalid instance", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand({ instanceId: 99 })),
					new Error("Instance with ID 99 does not exist")
				);
			});
			it("should error on unassigned instance", function() {
				mockInstanceConfig.set("instance.assigned_host", null);
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand({ instanceId: 100 })),
					new Error("Instance is not assigned to a host")
				);
			});
			it("should error on instance with disconnected host", function() {
				mockInstanceConfig.set("instance.assigned_host", 99);
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand({ instanceId: 100 })),
					new Error("Host containing instance is not connected")
				);
			});
			it("should error on invalid host", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), Address.fromShorthand({ hostId: 99 })),
					new Error("Host is not connected")
				);
			});
			it("should error on invalid broadcast", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), new Address(Address.broadcast, 99)),
					new Error("Unexpected broadcast target 99")
				);
			});
			it("should error on invalid address", function() {
				assert.throws(
					() => controller.sendEvent(new MockEvent(), new Address(99, 99)),
					new Error("Unknown address type 99")
				);
			});
		});

		describe(".instances", function() {
			it("should set the dirty flag if the config is updated", function() {
				controller.instances.dirty = false;
				mockInstanceConfig.set("instance.assigned_host", null);
				assert(controller.instances.dirty === true, "dirty flag was not set");
			});
		});
		describe(".finaliseHosts()", function() {
			it("resets the connected state to false", function() {
				const hostInfo = new HostInfo(1, "", "", new Map(), true);
				Controller.finaliseHosts(hostInfo);
				assert.equal(hostInfo.connected, false);
				assert(hostInfo.updatedAtMs > 0, "updatedAtMs not incremented");
			});
			it("does not increment updatedAtMs when there are no changes", function() {
				const hostInfo = new HostInfo(1, "", "", new Map(), false);
				Controller.finaliseHosts(hostInfo);
				assert.equal(hostInfo.connected, false);
				assert(hostInfo.updatedAtMs === 0, "updatedAtMs incremented");
			});
		});
		describe(".finaliseInstances()", function() {
			it("resets the stats for assigned instances", function() {
				const instanceConfig = new InstanceConfig("controller", { "instance.assigned_host": 1 });
				const instanceInfo = new InstanceInfo(instanceConfig, "running");
				Controller.finaliseInstances(instanceInfo);
				assert.equal(instanceInfo.status, "unknown");
				assert(instanceInfo.updatedAtMs > 0, "updatedAtMs not incremented");
			});
			it("resets the status for unassigned instances", function() {
				const instanceConfig = new InstanceConfig("controller", { "instance.assigned_host": null });
				const instanceInfo = new InstanceInfo(instanceConfig, "running");
				Controller.finaliseInstances(instanceInfo);
				assert.equal(instanceInfo.status, "unassigned");
				assert(instanceInfo.updatedAtMs > 0, "updatedAtMs not incremented");
			});
			it("does not update updatedAtMs when there are no changes (assigned)", function() {
				const instanceConfig = new InstanceConfig("controller", { "instance.assigned_host": 1 });
				const instanceInfo = new InstanceInfo(instanceConfig, "unknown");
				Controller.finaliseInstances(instanceInfo);
				assert.equal(instanceInfo.status, "unknown");
				assert(instanceInfo.updatedAtMs === 0, "updatedAtMs incremented");
			});
			it("does not update updatedAtMs when there are no changes (unassigned)", function() {
				const instanceConfig = new InstanceConfig("controller", { "instance.assigned_host": null });
				const instanceInfo = new InstanceInfo(instanceConfig, "unassigned");
				Controller.finaliseInstances(instanceInfo);
				assert.equal(instanceInfo.status, "unassigned");
				assert(instanceInfo.updatedAtMs === 0, "updatedAtMs incremented");
			});
		});
	});
	describe("migrations", function() {
		describe("SystemInfo", function() {
			it("migrates 'canRestart' from undefined to false", function() { // Alpha 17
				const result = Controller.migrateSystems([
					{}, { canRestart: true }, { canRestart: false },
				]);
				assert.equal(result[0].canRestart, false);
				assert.equal(result[1].canRestart, true);
				assert.equal(result[2].canRestart, false);
			});
			it("migrates 'restartRequired' from undefined to false", function() { // Alpha 21
				const result = Controller.migrateSystems([
					{}, { restartRequired: true }, { restartRequired: false },
				]);
				assert.equal(result[0].restartRequired, false);
				assert.equal(result[1].restartRequired, true);
				assert.equal(result[2].restartRequired, false);
			});
			it("does nothing for upto date data", function() {
				const systemInfo = new SystemInfo(
					1, "name", "n", "k", "m", "cm", "cr", "mc", "ma", "dc", "da", false, false, 0, false
				);
				const jsonString = JSON.stringify(systemInfo);
				const systemInfoJson = JSON.parse(jsonString);
				const systemInfoJsonCopy = JSON.parse(jsonString);
				const result = Controller.migrateSystems([
					systemInfoJson, systemInfoJson, systemInfoJson,
				]);
				assert.deepEqual(result, [
					systemInfoJsonCopy, systemInfoJsonCopy, systemInfoJsonCopy,
				]);
			});
		});
		describe("HostInfo", function() {
			it("migrates to the new format", function() { // Alpha 19
				const result = Controller.migrateHosts([
					["", "foo"], ["", "bar"], ["", "baz"],
				]);
				assert.deepEqual(result, [
					"foo", "bar", "baz",
				]);
			});
			it("does nothing for upto date data", function() {
				const hostInfo = new HostInfo(1, "", "", new Map());
				const jsonString = JSON.stringify(hostInfo);
				const hostInfoJson = JSON.parse(jsonString);
				const hostInfoJsonCopy = JSON.parse(jsonString);
				const result = Controller.migrateHosts([
					hostInfoJson, hostInfoJson, hostInfoJson,
				]);
				assert.deepEqual(result, [
					hostInfoJsonCopy, hostInfoJsonCopy, hostInfoJsonCopy,
				]);
			});
		});
		describe("InstanceInfo", function() {
			it("migrates to the new format", function() { // Alpha 14
				const result = Controller.migrateInstances([
					{ name: "foo" }, { name: "bar" }, { name: "baz" },
				]);
				assert.deepEqual(result, [
					{ config: { name: "foo" }, status: "running" },
					{ config: { name: "bar" }, status: "running" },
					{ config: { name: "baz" }, status: "running" },
				]);
			});
			it("does nothing for upto date data", function() {
				const instanceConfig = new InstanceConfig("controller");
				const instanceInfo = new InstanceInfo(instanceConfig, "unknown");
				const jsonString = JSON.stringify(instanceInfo);
				const instanceInfoJson = JSON.parse(jsonString);
				const instanceInfoJsonCopy = JSON.parse(jsonString);
				const result = Controller.migrateInstances([
					instanceInfoJson, instanceInfoJson, instanceInfoJson,
				]);
				assert.deepEqual(result, [
					instanceInfoJsonCopy, instanceInfoJsonCopy, instanceInfoJsonCopy,
				]);
			});
		});
		describe("Role", function() {
			it("migrates renamed permissions", function() { // Alpha 17
				const result = Controller.migrateRoles([
					{ permissions: ["foo", "bar", "core.instance.save.list.subscribe"] },
					{ permissions: ["bar", "core.instance.save.list.subscribe"] },
					{ permissions: ["core.instance.save.subscribe"] },
				]);
				assert.deepEqual(result, [
					{ permissions: ["foo", "bar", "core.instance.save.subscribe"] },
					{ permissions: ["bar", "core.instance.save.subscribe"] },
					{ permissions: ["core.instance.save.subscribe"] },
				]);
			});
			it("does nothing for upto date data", function() {
				const role = new Role(
					0, "n", "d", new Set("p1", "p2"), 0, false
				);
				const jsonString = JSON.stringify(role);
				const roleJson = JSON.parse(jsonString);
				const roleJsonCopy = JSON.parse(jsonString);
				const result = Controller.migrateRoles([
					roleJson, roleJson, roleJson,
				]);
				assert.deepEqual(result, [
					roleJsonCopy, roleJsonCopy, roleJsonCopy,
				]);
			});
		});
	});
});
