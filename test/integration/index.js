"use strict";
const path = require("path");
const fs = require("fs-extra");
const child_process = require("child_process");
const jwt = require("jsonwebtoken");
const needle = require("needle");
const util = require("util");
const events = require("events");

const link = require("lib/link");
const server = require("lib/factorio/server");


class TestControl extends link.Link {
	constructor(connector) {
		super("control", "master", connector);
		link.attachAllMessages(this);
	}

	async prepareDisconnectRequestHandler(message, request) {
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async debugWsMessageEventHandler() { }

	async instanceOutputEventHandler() { }
}

class TestControlConnector extends link.WebSocketClientConnector {
	register() {
		this.sendHandshake("register_control", { token: this.token, agent: "clusterctl", version: "test" });
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

async function get(path) {
	let res = await needle("get", `https://localhost:4443${path}`, { rejectUnauthorized: false });
	if (res.statusCode != 200) {
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
let databaseDir = path.join("temp", "test", "databse");
let masterConfigPath = path.join("temp", "test", "master-integration.json");
let slaveConfigPath = path.join("temp", "test", "slave-integration.json");
let controlConfigPath = path.join("temp", "test", "control-integration.json");

async function exec(...args) {
	console.log(args[0]);
	return await util.promisify(child_process.exec)(...args);
}

async function sendRcon(instanceId, command) {
	let response = await link.messages.sendRcon.send(control, { instance_id: instanceId, command });
	return response.result;
}

function getControl() {
	return control;
}

function spawn(name, cmd, waitFor) {
	return new Promise((resolve, reject) => {
		console.log(cmd);
		let parts = cmd.split(" ");
		let process = child_process.spawn(parts[0], parts.slice(1));
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

	await fs.remove(masterConfigPath);
	await fs.remove(slaveConfigPath);
	await fs.remove(controlConfigPath);

	await exec(`node master --config ${masterConfigPath} config set master.database_directory ${databaseDir}`);
	await exec(`node master --config ${masterConfigPath} config set master.auth_secret TestSecretDoNotUse`);
	await exec(`node master --config ${masterConfigPath} config set master.http_port 8880`);
	await exec(`node master --config ${masterConfigPath} config set master.https_port 4443`);
	await exec(`node master --config ${masterConfigPath} config set master.tls_certificate ${path.join(databaseDir, "cert.crt")}`);
	await exec(`node master --config ${masterConfigPath} config set master.tls_private_key ${path.join(databaseDir, "cert.key")}`);
	await exec(`node master --config ${masterConfigPath} config set master.tls_bits 1024`);
	await exec(`node master --config ${masterConfigPath} config set master.heartbeat_interval 0.25`);
	await exec(`node master --config ${masterConfigPath} config set master.connector_shutdown_timeout 2`);

	await exec(`node master --config ${masterConfigPath} bootstrap create-admin test`);
	await exec(`node master --config ${masterConfigPath} bootstrap create-ctl-config test --output ${controlConfigPath}`);

	masterProcess = await spawn("master:", `node master --config ${masterConfigPath} run`, "All plugins loaded");

	await exec(`node clusterctl --config ${controlConfigPath} create-slave-config --id 4 --name slave --generate-token --output ${slaveConfigPath}`);
	await exec(`node slave --config ${slaveConfigPath} config set slave.instances_directory ${instancesDir}`);

	slaveProcess = await spawn("slave:", `node slave --config ${slaveConfigPath} run`, "SOCKET | received ready from master");

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
	sendRcon,
	getControl,

	url,
	instancesDir,
	databaseDir,
	masterConfigPath,
	slaveConfigPath,
	controlConfigPath,
};
