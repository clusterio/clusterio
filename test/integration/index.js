const path = require("path");
const fs = require("fs-extra");
const child_process = require("child_process");
const jwt = require("jsonwebtoken");
const needle = require("needle");
const util = require("util");
const events = require("events");

const server = require("lib/factorio/server");


// Mark that this test takes a lot of time, or depeneds on a test
// that takes a lot of time.
function slowTest(test) {
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

let url = "https://localhost:4443/";
let token = jwt.sign({ id: "api" }, "TestSecretDoNotUse");
let instancesDir = path.join("test", "temp", "instances");
let databaseDir = path.join("test", "temp", "databse");
let masterConfigPath = path.join("test", "temp", "master-integration.json");
let slaveConfigPath = path.join("test", "temp", "slave-integration.json");
let controlConfigPath = path.join("test", "temp", "control-integration.json");

async function exec(...args) {
	console.log(args[0]);
	return await util.promisify(child_process.exec)(...args);
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
		})
		let stderr = new server._LineSplitter((line) => { console.log(name, line.toString("utf8")); })
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
	await exec(`node master --config ${masterConfigPath} config set master.heartbeat_interval 0.25`);

	await exec(`node client --config ${slaveConfigPath} config set slave.id 4`);
	await exec(`node client --config ${slaveConfigPath} config set slave.name slave`);
	await exec(`node client --config ${slaveConfigPath} config set slave.instances_directory ${instancesDir}`);
	await exec(`node client --config ${slaveConfigPath} config set slave.master_url "${url}"`);
	await exec(`node client --config ${slaveConfigPath} config set slave.master_token "${token}"`);

	await exec(`node clusterctl --config ${controlConfigPath} control-config set control.master_url "https://localhost:4443/"`);
	await exec(`node clusterctl --config ${controlConfigPath} control-config set control.master_token "${token}"`);

	masterProcess = await spawn("master:", `node master --config ${masterConfigPath} run`, "All plugins loaded");
	slaveProcess = await spawn("slave:", `node client --config ${slaveConfigPath} start`, "SOCKET | received ready from master");
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



module.exports = {
	slowTest,
	get,
	exec,

	url,
	token,
	instancesDir,
	databaseDir,
	masterConfigPath,
	slaveConfigPath,
	controlConfigPath,
};
