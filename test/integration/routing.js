"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");
const { Host, Instance, InstanceConnection } = require("@clusterio/host");
const { ControlConnection, Controller, HostConnection, InstanceRecord } = require("@clusterio/controller");

// Although there are no imports, the file has side-effects such as "before" which can effect tests
require("./index");

const addr = lib.Address.fromShorthand;

class Control extends lib.Link { }

/**
 * @param {Controller} controller
 * @param {number} hostId
 */
function connectHost(controller, hostId, plugins) {
	const [controllerSide, hostSide] = lib.VirtualConnector.makePair(addr("controller"), addr({ hostId }));
	const registerData = new lib.RegisterHostData("", "0.0.0", hostId, plugins);
	const hostConnection = new HostConnection(registerData, controllerSide, controller, "host-a.test");
	controller.wsServer.hostConnections.set(hostId, hostConnection);
	const hostConfig = new lib.HostConfig("host");
	hostConfig.set("host.id", hostId);
	return new Host(hostSide, hostConfig, undefined, []);
}

/**
 * @param {Controller} controller
 * @param {Host} host
 * @param {number} instanceId
 */
function connectInstance(controller, host, instanceId) {
	const hostAddress = addr({ hostId: host.config.get("host.id")});
	const instanceAddress = addr({ instanceId });
	const [instanceSide, hostSide] = lib.VirtualConnector.makePair(instanceAddress, hostAddress);
	const instanceConfig = new lib.InstanceConfig("host");
	instanceConfig.set("instance.id", instanceId);
	instanceConfig.set("instance.assigned_host", host.config.get("host.id"));
	host.assignedInstances.set(instanceId, { path: "invalid", config: instanceConfig });
	controller.instances.set(new InstanceRecord(instanceConfig, "stopped"));
	const instance = new Instance(host, instanceSide, "invalid", "invalid", instanceConfig);
	const instanceConnection = new InstanceConnection(hostSide, host, instance);
	host.instanceConnections.set(instanceId, instanceConnection);
	return instance;
}

/**
 * @param {Controller} controller
 * @param {number} hostId
 */
function connectControl(controller, controlId) {
	const [controllerSide, controlSide] = lib.VirtualConnector.makePair(addr("controller"), addr({ controlId }));
	const registerData = new lib.RegisterControlData("", "0.0.0");
	const user = controller.users.getOrCreateUser("test");
	const controlConnection = new ControlConnection(registerData, controllerSide, controller, user, controlId);
	controller.wsServer.controlConnections.set(controlId, controlConnection);
	return new Control(controlSide);
}

class TestRequest {
	static type = "request";
	static src = ["controller", "host", "instance", "control"];
	static dst = ["controller", "host", "instance", "control"];
	static permission = null;
}

class TestEvent {
	static type = "event";
	static src = ["controller", "host", "instance", "control"];
	static dst = ["controller", "host", "instance", "control"];
	static permission = null;
}

class PluginEvent {
	static type = "event";
	static src = ["controller", "host", "instance", "control"];
	static dst = ["controller", "host", "instance", "control"];
	static permission = null;
	static plugin = "test";
}

lib.Link.register(TestRequest);
lib.Link.register(TestEvent);
lib.Link.register(PluginEvent);

describe("Integration of link routing", function() {
	/** @type {Controller} */
	let controller;
	/** @type {Host} */
	let hostA;
	/** @type {Host} */
	let hostB;
	/** @type {Instance} */
	let instanceA1;
	/** @type {Instance} */
	let instanceA2;
	/** @type {Instance} */
	let instanceB1;
	/** @type {Control} */
	let controlA;
	/** @type {Control} */
	let controlB;

	beforeEach(function() {
		controller = new Controller({}, [], new lib.ControllerConfig("controller"));
		hostA = connectHost(controller, 10, []);
		hostB = connectHost(controller, 20, []);
		instanceA1 = connectInstance(controller, hostA, 11);
		instanceA2 = connectInstance(controller, hostA, 12);
		instanceB1 = connectInstance(controller, hostB, 21);
		controlA = connectControl(controller, 100);
		controlB = connectControl(controller, 101);
	});

	/** @returns {Controller | Host | Instance} */
	function get(name) {
		return {
			controller,
			hostA,
			hostB,
			instanceA1,
			instanceA2,
			instanceB1,
			controlA,
			controlB,
		}[name];
	}

	// Combinations to try. Equivalent paths have been removed.
	const parties = [
		["controller", ["hostA", "instanceA1", "controlA"]],
		["hostA", ["controller", "hostB", "instanceA1", "instanceB1", "controlA"]],
		["instanceA1", ["controller", "hostA", "hostB", "instanceA2", "instanceB1", "controlA"]],
		["controlA", ["controller", "hostA", "instanceA1", "controlB"]],
	];

	function handle(dst, Message, handler) {
		if (dst instanceof Controller) {
			for (const host of dst.wsServer.hostConnections.values()) {
				host.handle(Message, handler);
			}
			for (const control of dst.wsServer.controlConnections.values()) {
				control.handle(Message, handler);
			}
		} else if (dst instanceof Host) {
			for (const instance of dst.instanceConnections.values()) {
				instance.handle(Message, handler);
			}
			dst.handle(Message, handler);
		} else {
			dst.handle(Message, handler);
		}
	}

	/**
	 * @param {Controller | Host | Instance} link
	 * @param {Address} dst
	 */
	function send(link, dst, message) {
		// This logic exists becasue .sendTo doesn't forward all kinds of
		// messages to the correct location from all places.  Idealy this
		// would not be neccessary and .sendTo would do the right thing.
		if (link instanceof Host) {
			const instance = link.instanceConnections.get(dst.id);
			if (instance) {
				return instance.sendTo(dst, message);
			}
		}
		return link.sendTo(dst, message);
	}

	describe("request routing", function() {
		for (const [srcName, dstNames] of parties) {
			it(`should route from ${srcName}`, async function() {
				for (const dstName of dstNames) {
					let called;
					const dst = get(dstName);
					handle(dst, TestRequest, async () => { called = true; });
					const dstAddr = dst instanceof Controller ? addr("controller") : dst.connector.src;
					await send(get(srcName), dstAddr, new TestRequest());
					assert(called, `${dstName} handler was not called`);
				}
			});
		}
	});

	describe("event routing", function() {
		for (const [srcName, dstNames] of parties) {
			it(`should route from ${srcName}`, async function() {
				for (const dstName of dstNames) {
					let called;
					const dst = get(dstName);
					handle(dst, TestEvent, async () => { called = true; });
					const dstAddr = dst instanceof Controller ? addr("controller") : dst.connector.src;
					send(get(srcName), dstAddr, new TestEvent());
					assert(called, `${dstName} handler was not called`);
				}
			});
		}
	});

	/**
	 * @param {Controller | Host | Instance | Control} link
	 * @param {"allHosts" | "allInstances" | "allControls"} dst
	 */
	function bcast(link, dst, message) {
		// This logic exists becasue .sendTo doesn't forward all kinds of
		// messages to the correct location from all places.  Idealy this
		// would not be neccessary and .sendTo would do the right thing.
		if (link instanceof Host) {
			const plugin = message.constructor.plugin;
			if (dst === "allInstances") {
				for (const instance of link.instanceConnections.values()) {
					if (plugin && !instance.plugins.has(plugin)) {
						continue;
					}
					instance.sendTo(dst, message);
				}
			}
			if (plugin && !link.serverPlugins.has(plugin)) {
				return;
			}
		}
		link.sendTo(dst, message);
	}

	function bhandle(srcName, dst, Event, canReach = (dstB) => true) {
		const asserts = [];
		const dsts = {
			allHosts: ["hostA", "hostB"],
			allInstances: ["instanceA1", "instanceA2", "instanceB1"],
			allControls: ["controlA", "controlB"],
		};
		for (const dstName of dsts[dst]) {
			if (srcName === dstName) { continue; }
			// TODO remove when broadcasting from instance to hosts is fixed, see #575
			if (srcName === "instanceA1" && dstName === "hostB") { continue; }
			let called;
			handle(get(dstName), Event, async () => { called = true; });
			const should = canReach(dstName);
			asserts.push(() => assert(
				!should ^ called,
				`${dstName} handler was ${should ? "not " : ""}called from ${srcName}`,
			));
		}
		return asserts;
	}

	describe("event broadcast", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should broadcast from ${srcName}`, async function() {
				for (const dstName of ["allHosts", "allInstances", "allControls"]) {
					const dstAsserts = bhandle(srcName, dstName, TestEvent);
					bcast(get(srcName), dstName, new TestEvent());
					for (const dstAssert of dstAsserts) {
						dstAssert();
					}
				}
			});
		}
	});

	const graph = {
		controller: ["hostA", "hostB", "controlA", "controlB"],
		hostA: ["controller", "instanceA1", "instanceA2"],
		hostB: ["controller", "instanceB1"],
		instanceA1: ["hostA"],
		instanceA2: ["hostA"],
		instanceB1: ["hostB"],
		controlA: ["controller"],
		controlB: ["controller"],
	};

	// Returns true if the path from src to dst goes through via
	function goesVia(src, dst, via) {
		// Places we've been to
		const checked = new Set();
		// Places left to check
		const paths = new Set([src]);
		while (paths.size) {
			const [candidate] = paths;
			paths.delete(candidate);
			if (candidate === via) {
				continue;
			}
			if (checked.has(candidate)) {
				continue;
			}
			if (candidate === dst) {
				return false;
			}
			checked.add(candidate);
			for (const newCandidate of graph[candidate]) {
				paths.add(newCandidate);
			}
		}
		return true;
	}
	assert(goesVia("instanceA1", "instanceB1", "controller"));
	assert(!goesVia("instanceA1", "instanceA2", "controller"));
	assert(goesVia("instanceA1", "hostB", "hostA"));
	assert(!goesVia("instanceA1", "hostB", "controlA"));
	assert(goesVia("controlA", "controlB", "controller"));
	assert(goesVia("controlA", "hostA", "controller"));

	function addPluginExceptFor(exName) {
		const ex = get(exName);
		const exAddr = ex instanceof Controller ? addr("controller") : ex.connector.src;
		for (const name of [
			"controller", "hostA", "hostB", "instanceA1", "instanceA2", "instanceB1", "controlA", "controlB",
		]) {
			const party = get(name);
			if (party instanceof Controller) {
				for (const host of party.wsServer.hostConnections.values()) {
					if (!host.connector.dst.equals(exAddr)) {
						host.plugins.set("test", "0.0.0");
					}
				}
				for (const control of party.wsServer.controlConnections.values()) {
					if (!control.connector.dst.equals(exAddr)) {
						// No way to set plugins
					}
				}
			} else if (party instanceof Host) {
				for (const instance of party.instanceConnections.values()) {
					if (!instance.connector.dst.equals(exAddr)) {
						instance.plugins.set("test", "0.0.0");
					}
				}
				if (!party.connector.dst.equals(exAddr)) {
					party.serverPlugins.set("test", "0.0.0");
				}
			} else if (party instanceof Instance) {
				// Currently does not handle plugins
			} else if (party instanceof Control) {
				// Currently does not handle plugins
			}
		}
	}

	// When plugin events are broadcast the party sending the event should
	// filter it out if the next hop it is forwarded to does not have plugin
	// the event was defined in loaded.
	describe("event broadcast with controller missing plugin", function() {
		for (const srcName of ["hostA", "instanceA1", "controlA"]) {
			it(`should broadcast from ${srcName}`, async function() {
				if (srcName === "controlA") {
					this.skip(); // Not implemented
				}
				addPluginExceptFor("controller");
				for (const dstName of ["allHosts", "allInstances", "allControls"]) {
					const dstAsserts = bhandle(
						srcName, dstName, PluginEvent, dstB => !goesVia(srcName, dstB, "controller"),
					);
					bcast(get(srcName), dstName, new PluginEvent());
					for (const dstAssert of dstAsserts) {
						dstAssert();
					}
				}
			});
		}
	});

	describe("event broadcast with host missing plugin", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should broadcast from ${srcName}`, async function() {
				addPluginExceptFor("hostB");
				for (const dstName of ["allHosts", "allInstances", "allControls"]) {
					const dstAsserts = bhandle(
						srcName, dstName, PluginEvent, dstB => !goesVia(srcName, dstB, "hostB"),
					);
					bcast(get(srcName), dstName, new PluginEvent());
					for (const dstAssert of dstAsserts) {
						dstAssert();
					}
				}
			});
		}
	});

	describe("event broadcast with instance missing plugin", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should broadcast from ${srcName}`, async function() {
				addPluginExceptFor("instanceA2");
				for (const dstName of ["allHosts", "allInstances", "allControls"]) {
					const dstAsserts = bhandle(
						srcName, dstName, PluginEvent, dstB => !goesVia(srcName, dstB, "instanceA2"),
					);
					bcast(get(srcName), dstName, new PluginEvent());
					for (const dstAssert of dstAsserts) {
						dstAssert();
					}
				}
			});
		}
	});

	describe("event broadcast with control missing plugin", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should broadcast from ${srcName}`, async function() {
				this.skip(); // Currently not implemented.
				addPluginExceptFor("controlB");
				for (const dstName of ["allHosts", "allInstances", "allControls"]) {
					const dstAsserts = bhandle(
						srcName, dstName, PluginEvent, dstB => !goesVia(srcName, dstB, "controlB"),
					);
					bcast(get(srcName), dstName, new PluginEvent());
					for (const dstAssert of dstAsserts) {
						dstAssert();
					}
				}
			});
		}
	});

	describe("event should not be routable on loopback", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should not loopback on ${srcName}`, async function() {
				const src = get(srcName);
				const dstAddr = src instanceof Controller ? addr("controller") : src.connector.src;
				assert.throws(
					() => send(src, dstAddr, new TestEvent()),
					new Error(`Message would return back to sender ${dstAddr}.`)
				);
			});
		}
	});

	describe("request should not be routable on loopback", function() {
		for (const srcName of ["controller", "hostA", "instanceA1", "controlA"]) {
			it(`should not loopback on ${srcName}`, async function() {
				const src = get(srcName);
				const dstAddr = src instanceof Controller ? addr("controller") : src.connector.src;
				assert.throws(
					() => send(src, dstAddr, new TestRequest()),
					new Error(`Message would return back to sender ${dstAddr}.`)
				);
			});
		}
	});
});
