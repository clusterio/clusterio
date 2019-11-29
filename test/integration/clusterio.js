const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const link = require("lib/link");
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

	before(async function() {
		master._db.slaves = new Map();
		master._db.instances = new Map([
			[11, { id: 11, name: "foo", slaveId: 4 }],
			[21, { id: 21, name: "bar", slaveId: 5 }],
		]);

		Object.assign(master._config, {
			description: "test",
			visibility: { public: false, lan: false },
			username: "test",
			token: "",
			game_password: "",
			verify_user_identity: false,
			allow_commands: "admins-only",
			auto_pause: false,
		});

		let [controlClient, controlServer] = link.VirtualConnector.makePair();
		testControl = new clusterctl._Control(controlClient);
		testControlConnection = new master._ControlConnection({ agent: "test", version }, controlServer);
		master._controlConnections.push(testControlConnection);

		await fs.remove(instancesDir);
		await fs.ensureDir(instancesDir)
		let [slaveClient, slaveServer] = link.VirtualConnector.makePair();
		testSlave = new client._Slave(slaveClient, {
			id: 4,
			name: "slave",
			instanceDirectory: instancesDir,
			factorioDirectory: "factorio",
			masterURL: "http://invalid",
			masterAuthToken: "invalid",
			publicIP: "invalid",
		});
		testSlave.instances = await testSlave.findInstances();
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
				await clusterctl._commands.get("create-instance").run({name: "test", slave: "slave"}, testControl);
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance was not created");
			});
		});

		describe("create-save", function() {
			slowTest(this);
			it("creates a save", async function() {
				await clusterctl._commands.get("create-save").run({instance: "test"}, testControl);
			});
		});

		describe("start-instance", function() {
			slowTest(this);
			it("starts the instance", async function() {
				await clusterctl._commands.get("start-instance").run({instance: "test"}, testControl);
				// TODO check that the instance actually stopped
			});
		});

		describe("send-rcon", function() {
			slowTest(this);
			it("sends the command", async function() {
				await clusterctl._commands.get("send-rcon").run({instance: "test", command: "test"}, testControl);
				// TODO check that the command was received
			});
		});

		describe("stop-instance", function() {
			slowTest(this);
			it("stops the instance", async function() {
				await clusterctl._commands.get("stop-instance").run({instance: "test"}, testControl);
				// TODO check that the instance actually stopped
			});
		});

		describe("delete-instance", function() {
			slowTest(this);
			it("deletes the instance", async function() {
				await clusterctl._commands.get("delete-instance").run({instance: "test"}, testControl);
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance was not deleted");
			});
		});
	});
});
