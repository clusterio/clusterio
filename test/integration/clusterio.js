const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const link = require("lib/link");
const plugin = require("lib/plugin");
const config = require("lib/config");
const master = require("../../master");
const client = require("../../client");
const clusterctl = require("../../clusterctl");
const { version } = require("../../package");


describe("Integration of Clusterio", function() {
	let testControl;
	let testControlConnection;

	let testSlave;
	let testSlaveConnection;

	let instancesDir = path.join("test", "temp", "instances");

	// Mark that this test takes a lot of time, or depeneds on a test
	// that takes a lot of time.
	function slowTest(test) {
		if (process.env.FAST_TEST) {
			test.skip();
		}

		test.timeout(20000);
	}

	async function createInstanceConfig(id, name, assignedSlave) {
		let instanceConfig = new config.InstanceConfig()
		await instanceConfig.init();
		instanceConfig.set("instance.id", id);
		instanceConfig.set("instance.name", name);
		instanceConfig.set("instance.assigned_slave", assignedSlave);
		return instanceConfig;
	}

	before(async function() {
		master._db.slaves = new Map();
		master._db.instances = new Map([
			[11, await createInstanceConfig(11, "foo", 4)],
			[21, await createInstanceConfig(21, "bar", 5)],
		]);

		let [controlClient, controlServer] = link.VirtualConnector.makePair();
		testControl = new clusterctl._Control(controlClient);
		testControlConnection = new master._ControlConnection({ agent: "test", version }, controlServer);
		master._controlConnections.push(testControlConnection);

		await fs.remove(instancesDir);
		await fs.ensureDir(instancesDir)

		let slaveConfig = new config.SlaveConfig();
		await slaveConfig.init();
		slaveConfig.set("slave.id", 4);
		slaveConfig.set("slave.name", "slave");
		slaveConfig.set("slave.instances_directory", instancesDir);
		slaveConfig.set("slave.factorio_directory", "factorio");
		slaveConfig.set("slave.master_url", "http://invalid");
		slaveConfig.set("slave.master_token", "invalid");
		slaveConfig.set("slave.public_address", "invalid");

		let [slaveClient, slaveServer] = link.VirtualConnector.makePair();
		testSlave = new client._Slave(slaveClient, slaveConfig, await plugin.loadPluginInfos("plugins"));
		testSlaveConnection = new master._SlaveConnection({ agent: "test", version, name: "slave", id: 4}, slaveServer);
		master._slaveConnections.set(4, testSlaveConnection);
	});

	describe("clusterctl", function() {
		describe("list-slaves", function() {
			it("does not throw", async function() {
				await clusterctl._commands.get("list-slaves").run({}, testControl);
			});
		});
		describe("list-instances", function() {
			it("does not throw", async function() {
				await clusterctl._commands.get("list-instances").run({}, testControl);
			});
		});

		describe("create-instances", function() {
			it("creates the instance", async function() {
				await clusterctl._commands.get("create-instance").run({id: 44, name: "test"}, testControl);
				assert(master._db.instances.has(44), "Instance was not created");

				// XXX breaks tests.
				master._db.instances.get(44).set("subspace_storage.enabled", false);
				master._db.instances.get(44).set("research_sync.enabled", false);
			});
		});

		describe("assign-instance", function() {
			it("creates the instance", async function() {
				await clusterctl._commands.get("assign-instance").run({instance: "test", slave: "slave"}, testControl);
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance was not created");
			});
		});

		describe("create-save", function() {
			it("creates a save", async function() {
				slowTest(this);
				await clusterctl._commands.get("create-save").run({instance: "test"}, testControl);
			});
		});

		describe("start-instance", function() {
			it("starts the instance", async function() {
				slowTest(this);
				await clusterctl._commands.get("start-instance").run({instance: "test"}, testControl);
				// TODO check that the instance actually stopped
			});
		});

		describe("send-rcon", function() {
			it("sends the command", async function() {
				slowTest(this);
				await clusterctl._commands.get("send-rcon").run({instance: "test", command: "test"}, testControl);
				// TODO check that the command was received
			});
		});

		describe("stop-instance", function() {
			it("stops the instance", async function() {
				slowTest(this);
				await clusterctl._commands.get("stop-instance").run({instance: "test"}, testControl);
				// TODO check that the instance actually stopped
			});
		});

		describe("delete-instance", function() {
			it("deletes the instance", async function() {
				slowTest(this);
				await clusterctl._commands.get("delete-instance").run({instance: "test"}, testControl);
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance was not deleted");
			});
		});
	});
});
