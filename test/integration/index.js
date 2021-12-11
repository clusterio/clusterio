/* eslint-disable no-console */
"use strict";
const path = require("path");
const fs = require("fs-extra");
const child_process = require("child_process");
const jwt = require("jsonwebtoken");
const phin = require("phin");
const util = require("util");
const events = require("events");

const libLink = require("@clusterio/lib/link");
const { LineSplitter } = require("@clusterio/lib/stream");
const { ConsoleTransport, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

// Make sure permissions from plugins are loaded
require("../../plugins/global_chat/info");
require("../../plugins/player_auth/info");
require("../../plugins/research_sync/info");
require("../../plugins/statistics_exporter/info");
require("../../plugins/subspace_storage/info");


class TestControl extends libLink.Link {
	constructor(connector) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);
		this.slaveUpdates = [];
		this.instanceUpdates = [];
		this.saveListUpdates = [];

		this.connector.on("connect", () => {
			libLink.messages.setSlaveSubscriptions.send(
				this, { all: true, slave_ids: [] }
			).catch(err => logger.error(`Error setting slave subscriptions:\n${err.stack}`));
			libLink.messages.setInstanceSubscriptions.send(
				this, { all: true, instance_ids: [] }
			).catch(err => logger.error(`Error setting instance subscriptions:\n${err.stack}`));
			libLink.messages.setSaveListSubscriptions.send(
				this, { all: true, instance_ids: [] }
			).catch(err => logger.error(`Error setting save list subscriptions:\n${err.stack}`));
		});
	}

	async prepareDisconnectRequestHandler(message, request) {
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async debugWsMessageEventHandler() { }

	async accountUpdateEventHandler() { }

	async slaveUpdateEventHandler(message) {
		this.slaveUpdates.push(message.data);
	}

	async instanceUpdateEventHandler(message) {
		this.instanceUpdates.push(message.data);
	}

	async saveListUpdateEventHandler(message) {
		this.saveListUpdates.push(message.data);
	}

	async logMessageEventHandler() { }
}

class TestControlConnector extends libLink.WebSocketClientConnector {
	register() {
		this.sendHandshake("register_control", { token: this.token, agent: "clusterioctl", version: "test" });
	}
}

// Mark that this test takes a lot of time, or depeneds on a test
// that takes a lot of time.
function slowTest(test) {
	// eslint-disable-next-line node/no-process-env
	if (process.env.FAST_TEST) {
		test.skip();
	}

	test.timeout(20000);
}

async function get(urlPath) {
	let res = await phin({
		method: "GET",
		url: `https://localhost:4443${urlPath}`,
		core: { rejectUnauthorized: false },
	});
	if (res.statusCode !== 200) {
		throw new Error(`Got response code ${res.statusCode}, content: ${res.body}`);
	}
	return res;
}

let masterProcess;
let slaveProcess;
let control;

let url = "https://localhost:4443/";
let controlToken = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));
let instancesDir = path.join("temp", "test", "instances");
let databaseDir = path.join("temp", "test", "database");
let pluginListPath = path.join("temp", "test", "plugin-list.json");
let masterConfigPath = path.join("temp", "test", "config-master.json");
let slaveConfigPath = path.join("temp", "test", "config-slave.json");
let controlConfigPath = path.join("temp", "test", "config-control.json");

async function exec(command, options = {}) {
	console.log(command);
	options = { cwd: path.join("temp", "test"), ...options };
	return await util.promisify(child_process.exec)(command, options);
}

async function execCtl(...args) {
	args[0] = `node ../../packages/ctl ${args[0]}`;
	return await exec(...args);
}

async function sendRcon(instanceId, command) {
	let response = await libLink.messages.sendRcon.send(control, { instance_id: instanceId, command });
	return response.result;
}

function getControl() {
	return control;
}

function spawn(name, cmd, waitFor) {
	return new Promise((resolve, reject) => {
		console.log(cmd);
		let parts = cmd.split(" ");
		let process = child_process.spawn(parts[0], parts.slice(1), { cwd: path.join("temp", "test") });
		let stdout = new LineSplitter({ readableObjectMode: true });
		stdout.on("data", line => {
			line = line.toString("utf8");
			if (waitFor.test(line)) {
				resolve(process);
			}
			console.log(name, line);
		});
		let stderr = new LineSplitter({ readableObjectMode: true });
		stderr.on("data", line => { console.log(name, line.toString("utf8")); });
		process.stdout.pipe(stdout);
		process.stderr.pipe(stderr);
	});
}

before(async function() {
	this.timeout(40000);

	// Some integration tests may cause log events
	logger.add(new ConsoleTransport({
		level: "info",
		format: new libLoggingUtils.TerminalFormat(),
	}));

	await fs.remove(databaseDir);
	await fs.remove(instancesDir);

	await fs.remove(pluginListPath);
	await fs.remove(masterConfigPath);
	await fs.remove(slaveConfigPath);
	await fs.remove(controlConfigPath);

	await fs.ensureDir(path.join("temp", "test"));

	await exec("node ../../packages/master config set master.auth_secret TestSecretDoNotUse");
	await exec("node ../../packages/master config set master.http_port 8880");
	await exec("node ../../packages/master config set master.https_port 4443");
	await exec("node ../../packages/master config set master.heartbeat_interval 0.25");
	await exec("node ../../packages/master config set master.session_timeout 2");
	await exec("node ../../packages/master config set master.tls_certificate ../../test/file/tls/cert.pem");
	await exec("node ../../packages/master config set master.tls_private_key ../../test/file/tls/key.pem");

	await exec("node ../../packages/ctl plugin add ../../plugins/global_chat");
	await exec("node ../../packages/ctl plugin add ../../plugins/research_sync");
	await exec("node ../../packages/ctl plugin add ../../plugins/statistics_exporter");
	await exec("node ../../packages/ctl plugin add ../../plugins/subspace_storage");
	await exec("node ../../packages/ctl plugin add ../../plugins/player_auth");

	await exec("node ../../packages/master bootstrap create-admin test");
	await exec("node ../../packages/master bootstrap create-ctl-config test");
	await exec("node ../../packages/ctl control-config set control.tls_ca ../../test/file/tls/cert.pem");

	masterProcess = await spawn("master:", "node ../../packages/master run", /Started master/);

	await execCtl("slave create-config --id 4 --name slave --generate-token");
	await exec(`node ../../packages/slave config set slave.factorio_directory ${path.join("..", "..", "factorio")}`);
	await exec("node ../../packages/slave config set slave.tls_ca ../../test/file/tls/cert.pem");

	slaveProcess = await spawn("slave:", "node ../../packages/slave run", /Started slave/);

	let tlsCa = await fs.readFile("test/file/tls/cert.pem");
	let controlConnector = new TestControlConnector(url, 2, tlsCa);
	controlConnector.token = controlToken;
	control = new TestControl(controlConnector);
	await controlConnector.connect();
});

after(async function() {
	this.timeout(20000);
	if (slaveProcess) {
		console.log("Shutting down slave");
		slaveProcess.kill("SIGINT");
		await events.once(slaveProcess, "exit");
	}
	if (masterProcess) {
		console.log("Shutting down master");
		masterProcess.kill("SIGINT");
		await events.once(masterProcess, "exit");
	}
	if (control) {
		await control.connector.close();
	}
});

// Ensure the test processes are stopped.
process.on("exit", () => {
	if (slaveProcess) { slaveProcess.kill(); }
	if (masterProcess) { masterProcess.kill(); }
});


module.exports = {
	TestControl,
	TestControlConnector,
	slowTest,
	get,
	exec,
	execCtl,
	sendRcon,
	getControl,
	spawn,

	url,
	controlToken,
	instancesDir,
	databaseDir,
	masterConfigPath,
	slaveConfigPath,
	controlConfigPath,
};
