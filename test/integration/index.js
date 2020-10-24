"use strict";
const path = require("path");
const fs = require("fs-extra");
const child_process = require("child_process");
const jwt = require("jsonwebtoken");
const phin = require("phin");
const util = require("util");
const events = require("events");

const libLink = require("@clusterio/lib/link");
const server = require("@clusterio/lib/factorio/server");


class TestControl extends libLink.Link {
	constructor(connector) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);
	}

	async prepareDisconnectRequestHandler(message, request) {
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async debugWsMessageEventHandler() { }

	async instanceOutputEventHandler() { }
}

class TestControlConnector extends libLink.WebSocketClientConnector {
	register() {
		this.sendHandshake("register_control", { token: this.token, agent: "clusterioctl", version: "test" });
	}
}

// Mark that this test takes a lot of time, or depeneds on a test
// that takes a lot of time.
function slowTest(test) {
	// eslint-disable-next-line no-process-env
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
let controlToken = jwt.sign({ aud: "user", user: "test" }, "TestSecretDoNotUse");
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
		let stdout = new server._LineSplitter((line) => {
			line = line.toString("utf8");
			if (line.startsWith(waitFor)) {
				resolve(process);
			}
			console.log(name, line);
		});
		let stderr = new server._LineSplitter((line) => { console.log(name, line.toString("utf8")); });
		process.stdout.on("data", chunk => { stdout.data(chunk); });
		process.stdout.on("close", () => { stdout.end(); });
		process.stderr.on("data", chunk => { stderr.data(chunk); });
		process.stderr.on("close", () => { stderr.end(); });
	});
}

before(async function() {
	this.timeout(20000);

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
	await exec("node ../../packages/master config set master.tls_bits 1024");
	await exec("node ../../packages/master config set master.heartbeat_interval 0.25");
	await exec("node ../../packages/master config set master.connector_shutdown_timeout 2");

	await exec("node ../../packages/ctl plugin add ../../plugins/global_chat");
	await exec("node ../../packages/ctl plugin add ../../plugins/research_sync");
	await exec("node ../../packages/ctl plugin add ../../plugins/statistics_exporter");
	await exec("node ../../packages/ctl plugin add ../../plugins/subspace_storage");

	await exec("node ../../packages/master bootstrap create-admin test");
	await exec("node ../../packages/master bootstrap create-ctl-config test");

	masterProcess = await spawn("master:", "node ../../packages/master run", "All plugins loaded");

	let createArgs = "--id 4 --name slave --generate-token";
	await execCtl(`slave create-config ${createArgs}`);

	await exec(`node ../../packages/slave config set slave.factorio_directory ${path.join("..", "..", "factorio")}`);
	slaveProcess = await spawn("slave:", "node ../../packages/slave run", "SOCKET | received ready from master");

	let controlConnector = new TestControlConnector(url, 2);
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

	url,
	instancesDir,
	databaseDir,
	masterConfigPath,
	slaveConfigPath,
	controlConfigPath,
};
