/* eslint-disable no-console */
"use strict";
const path = require("path");
const fs = require("fs-extra");
const child_process = require("child_process");
const jwt = require("jsonwebtoken");
const phin = require("phin");
const util = require("util");
const events = require("events");

const lib = require("@clusterio/lib");
const { LineSplitter, ConsoleTransport, logger } = lib;

const { selectTargetCommand, initialize: initializeCtl } = require("@clusterio/ctl");

// Make sure permissions from plugins are loaded
require("../../plugins/global_chat/dist/node/index");
require("../../plugins/player_auth/dist/node/index");
require("../../plugins/research_sync/dist/node/index");
require("../../plugins/statistics_exporter/dist/node/index");
require("../../plugins/subspace_storage/dist/node/index");

class TestControl extends lib.Link {
	constructor(connector, subscribe = true) {
		super(connector);
		this.hostUpdates = [];
		this.instanceUpdates = [];
		this.saveUpdates = [];
		this.modUpdates = [];
		this.modPackUpdates = [];
		this.userUpdates = [];

		this.connector.on("connect", () => {
			if (!subscribe) {
				return;
			}
			this.send(
				new lib.SubscriptionRequest(lib.HostUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting host subscriptions:\n${err.stack}`));
			this.send(
				new lib.SubscriptionRequest(lib.InstanceDetailsUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting instance subscriptions:\n${err.stack}`));
			this.send(
				new lib.SubscriptionRequest(lib.InstanceSaveDetailsUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting save subscriptions:\n${err.stack}`));
			this.send(
				new lib.SubscriptionRequest(lib.ModUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting mod subscriptions:\n${err.stack}`));
			this.send(
				new lib.SubscriptionRequest(lib.ModPackUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting mod pack subscriptions:\n${err.stack}`));
			this.send(
				new lib.SubscriptionRequest(lib.UserUpdatesEvent.name, true)
			).catch(err => logger.error(`Error setting user subscriptions:\n${err.stack}`));
		});

		this.handle(lib.AccountUpdateEvent);
		this.handle(lib.HostUpdatesEvent, this.handleHostUpdatesEvent.bind(this));
		this.handle(lib.InstanceDetailsUpdatesEvent, this.handleInstanceDetailsUpdatesEvent.bind(this));
		this.handle(lib.InstanceSaveDetailsUpdatesEvent, this.handleInstanceSaveDetailsUpdatesEvent.bind(this));
		this.handle(lib.ModUpdatesEvent, this.handleModUpdatesEvent.bind(this));
		this.handle(lib.ModPackUpdatesEvent, this.handleModPackUpdatesEvent.bind(this));
		this.handle(lib.UserUpdatesEvent, this.handleUserUpdatesEvent.bind(this));
	}

	async handleHostUpdatesEvent(event) {
		this.hostUpdates.push(...event.updates);
	}

	async handleInstanceDetailsUpdatesEvent(event) {
		this.instanceUpdates.push(...event.updates);
	}

	async handleInstanceSaveDetailsUpdatesEvent(event) {
		this.saveUpdates.push(event);
	}

	async handleModUpdatesEvent(event) {
		this.modUpdates.push(...event.updates);
	}

	async handleModPackUpdatesEvent(event) {
		this.modPackUpdates.push(...event.updates);
	}

	async handleUserUpdatesEvent(event) {
		this.userUpdates.push(...event.updates);
	}

	async setLogSubscriptions(args) {
		// Do nothing
	}
}

class TestControlConnector extends lib.WebSocketClientConnector {
	register() {
		this.sendHandshake(
			new lib.MessageRegisterControl(
				new lib.RegisterControlData(
					this.token, "test",
				)
			)
		);
	}
}

class TestHostConnector extends lib.WebSocketClientConnector {
	register() {
		this.sendHandshake(
			new lib.MessageRegisterHost(
				new lib.RegisterHostData(
					this.token, "test",
					this.hostId, {},
				)
			)
		);
	}
}

// Mark that this test takes a lot of time, or depeneds on a test
// that takes a lot of time.
function slowTest(test) {

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

function loadJSON(filePath) {
	try {
		// eslint-disable-next-line node/no-sync
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (err) {
		if (err.code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
}

function getFactorioDir(hostConfig) {
	const factorioDir = hostConfig?.["host.factorio_directory"] ?? "factorio";
	return path.join(factorioDir);
}

let controllerProcess;
let hostProcess;
let control;

const baseHostConfig = loadJSON("config-host.json");

let url = "https://localhost:4443/";
let controlToken = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));
let instancesDir = path.join("temp", "test", "instances");
let modsDir = path.join("temp", "test", "mods");
let databaseDir = path.join("temp", "test", "database");
let factorioDir = getFactorioDir(baseHostConfig);
let pluginListPath = path.join("temp", "test", "plugin-list.json");
let controllerConfigPath = path.join("temp", "test", "config-controller.json");
let hostConfigPath = path.join("temp", "test", "config-host.json");
let controlConfigPath = path.join("temp", "test", "config-control.json");

async function exec(command, options = {}) {
	// Uncomment to show commands run in tests
	// console.log(command);
	options = { cwd: path.join("temp", "test"), ...options };
	return await util.promisify(child_process.exec)(command, options);
}

async function execController(...args) {
	args[0] = `node --enable-source-maps ../../packages/controller ${args[0]}`;
	return await exec(...args);
}

async function execHost(...args) {
	args[0] = `node --enable-source-maps ../../packages/host ${args[0]}`;
	return await exec(...args);
}

async function execCtlProcess(...args) {
	args[0] = `node --enable-source-maps ../../packages/ctl ${args[0]}`;
	return await exec(...args);
}

async function execCtl(command) {
	process.chdir("temp/test");
	try {
		const initArgs = await initializeCtl(command, control.plugins, true);
		if (!initArgs.shouldRun) {
			return;
		}

		control.config = initArgs.controlConfig;
		const targetCommand = selectTargetCommand(initArgs.args, initArgs.rootCommands);
		await targetCommand.run(initArgs.args, control);
	} finally {
		process.chdir("../..");
	}
}

async function sendRcon(instanceId, command) {
	return await control.sendTo({ instanceId }, new lib.InstanceSendRconRequest(command));
}

function getControl() {
	return control;
}

function spawn(name, cmd, waitFor) {

	const silent = process.env.SILENT_TEST;
	const bootstrap = !controllerProcess || !hostProcess;
	function log(...args) {
		if (!silent || bootstrap) {
			console.log(...args);
		}
	}

	return new Promise((resolve, reject) => {
		log(cmd);
		let parts = cmd.split(" ");
		let process = child_process.spawn(parts[0], parts.slice(1), { cwd: path.join("temp", "test") });
		let stdout = new LineSplitter({ readableObjectMode: true });
		let stderr = new LineSplitter({ readableObjectMode: true });
		let onDataOut = line => {
			line = line.toString("utf8");
			if (waitFor.test(line)) {
				if (silent) {
					stdout.off("data", onDataOut);
					stderr.off("data", onDataErr);
				}
				resolve(process);
			}
			log(name, line);
		};
		let onDataErr = line => {
			log(name, line.toString("utf8"));
		};
		stdout.on("data", onDataOut);
		stderr.on("data", onDataErr);
		process.stdout.pipe(stdout);
		process.stderr.pipe(stderr);
	});
}

async function spawnNode(name, cmd, waitFor) {
	return await spawn(name, `node --enable-source-maps ${cmd}`, waitFor);
}

before(async function() {
	this.timeout(40000);


	const silent = process.env.SILENT_TEST;
	if (silent) {
		console.log("SILENT_TEST is present in env, loggers after bootstrap will be muted.");
	}

	// Some integration tests may cause log events
	logger.add(new ConsoleTransport({
		level: "info",
		format: new lib.TerminalFormat(),
		filter: () => !silent,
	}));

	// If fast test is enabled then output that it is

	if (process.env.FAST_TEST) {
		console.log("FAST_TEST is present in env, slow tests will be skipped.");
	}

	await fs.remove(instancesDir);
	await fs.remove(modsDir);
	await fs.remove(databaseDir);

	await fs.remove(pluginListPath);
	await fs.remove(controllerConfigPath);
	await fs.remove(hostConfigPath);
	await fs.remove(controlConfigPath);

	await fs.ensureDir(path.join("temp", "test"));

	console.log("Building Mods");
	await fs.ensureDir(modsDir);
	await lib.build({
		build: true,
		pack: true,
		sourceDir: "packages/host/lua/clusterio_lib",
		outputDir: modsDir,
	});

	console.log("Setting Controller Config");
	await execController("config set controller.auth_secret TestSecretDoNotUse");
	await execController("config set controller.http_port 8880");
	await execController("config set controller.https_port 4443");
	await execController("config set controller.heartbeat_interval 0.25");
	await execController("config set controller.session_timeout 2");
	await execController("config set controller.tls_certificate ../../test/file/tls/cert.pem");
	await execController("config set controller.tls_private_key ../../test/file/tls/key.pem");

	console.log("Setting Controller Plugins");
	await execCtlProcess("plugin add ../../plugins/global_chat");
	await execCtlProcess("plugin add ../../plugins/research_sync");
	await execCtlProcess("plugin add ../../plugins/statistics_exporter");
	await execCtlProcess("plugin add ../../plugins/subspace_storage");
	await execCtlProcess("plugin add ../../plugins/inventory_sync");
	await execCtlProcess("plugin add ../../plugins/player_auth");

	console.log("Bootstrapping");
	await execController("bootstrap create-admin test");
	await execController("bootstrap create-ctl-config test");
	await execCtlProcess("control-config set control.tls_ca ../../test/file/tls/cert.pem");

	controllerProcess = await spawnNode("controller:", "../../packages/controller run", /Started controller/);

	const relativeFactorioDir = path.isAbsolute(factorioDir) ? factorioDir : path.join("..", "..", factorioDir);
	await execCtlProcess("host create-config --id 4 --name host --generate-token");
	await execHost(`config set host.factorio_directory ${relativeFactorioDir}`);
	await execHost("config set host.tls_ca ../../test/file/tls/cert.pem");

	hostProcess = await spawnNode("host:", "../../packages/host run", /Started host/);

	const tlsCa = await fs.readFile("test/file/tls/cert.pem");
	const controlConnector = new TestControlConnector(url, 2, tlsCa);
	controlConnector.token = controlToken;
	control = new TestControl(controlConnector);
	await controlConnector.connect();

	const initArgs = await initializeCtl(`--plugin-list ${pluginListPath} control-config list`, undefined, true);
	control.config = initArgs.controlConfig;
	control.plugins = initArgs.ctlPlugins;
	control.tlsCa = tlsCa;

	const testPack = lib.ModPack.fromJSON({});
	testPack.id = 12;
	testPack.name = "subspace_storage-pack";
	testPack.factorioVersion = "2.0.0";
	testPack.mods.set("clusterio_lib", { name: "clusterio_lib", enabled: true, version: "2.0.20" });
	await control.sendTo("controller", new lib.ModPackCreateRequest(testPack));
	await control.sendTo(
		"controller",
		new lib.ControllerConfigSetFieldRequest("controller.default_mod_pack_id", "12"),
	);
});

after(async function() {
	this.timeout(20000);
	if (hostProcess) {
		console.log("Shutting down host");
		hostProcess.kill("SIGINT");
		await events.once(hostProcess, "exit");
	}
	if (controllerProcess) {
		console.log("Shutting down controller");
		controllerProcess.kill("SIGINT");
		await events.once(controllerProcess, "exit");
	}
	if (control) {
		await control.connector.close();
	}
});

// Ensure the test processes are stopped.
process.on("exit", () => {
	if (hostProcess) { hostProcess.kill(); }
	if (controllerProcess) { controllerProcess.kill(); }
});


module.exports = {
	TestControl,
	TestControlConnector,
	TestHostConnector,
	execCtlProcess,
	slowTest,
	get,
	exec,
	execCtl,
	execHost,
	sendRcon,
	getControl,
	spawn,
	spawnNode,

	url,
	controlToken,
	instancesDir,
	modsDir,
	databaseDir,
	factorioDir,
	controllerConfigPath,
	hostConfigPath,
	controlConfigPath,
};
