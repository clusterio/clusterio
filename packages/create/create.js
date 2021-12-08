#!/usr/bin/env node

"use strict";
const child_process = require("child_process");
const events = require("events");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const os = require("os");
const path = require("path");
const phin = require("phin");
const stream = require("stream");
const util = require("util");
const yargs = require("yargs");

const { levels, logger, setLogLevel } = require("./logging");
let dev = false;
const scriptExt = process.platform === "win32" ? ".cmd" : "";


const availablePlugins = [
	{ name: "Global Chat", value: "@clusterio/plugin-global_chat" },
	{ name: "Inventory Sync", value: "@clusterio/plugin-inventory_sync" },
	{ name: "Player Auth", value: "@clusterio/plugin-player_auth" },
	{ name: "Research Sync", value: "@clusterio/plugin-research_sync" },
	{ name: "Statistics Exporter", value: "@clusterio/plugin-statistics_exporter" },
	{ name: "Subspace Storage", value: "@clusterio/plugin-subspace_storage" },

	// Comunity plugins
	{ name: "Discord Bridge", value: "@hornwitser/discord_bridge" },
	{ name: "Server Select", value: "@hornwitser/server_select" },
];

const factorioLocations = {
	win32: [
		"C:\\Program Files\\Factorio",
		"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Factorio",
	],
	darwin: [
		"/Applications/factorio.app/Contents",
	],
};


class LineSplitter extends stream.Transform {
	constructor(options) {
		super(options);
		this._partial = null;
	}

	_transform(chunk, encoding, callback) {
		if (this._partial) {
			chunk = Buffer.concat([this._partial, chunk]);
			this._partial = null;
		}

		while (chunk.length) {
			let end = chunk.indexOf("\n");
			if (end === -1) {
				this._partial = chunk;
				break;
			}

			let next = end + 1;
			// Eat carriage return as well if present
			if (end >= 1 && chunk[end-1] === "\r".charCodeAt(0)) {
				end -= 1;
			}

			let line = chunk.slice(0, end);
			chunk = chunk.slice(next);
			this.push(line);
		}
		callback();
	}

	_flush(callback) {
		if (this._partial) {
			this.push(this._partial);
			this._partial = null;
		}
		callback();
	}
}

class InstallError extends Error { }


async function safeOutputFile(file, data, options={}) {
	let temporary = `${file}.tmp`;
	await fs.outputFile(temporary, data, options);
	await fs.rename(temporary, file);
}

async function execFile(cmd, args) {
	logger.verbose(`executing ${cmd} ${args.join(" ")}`);
	const asyncExec = util.promisify(child_process.execFile);
	return new Promise((resolve, reject) => {
		let child = child_process.execFile(cmd, args, (err, stdout, stderr) => {
			if (err) {
				reject(err);
			} else {
				resolve({ stdout, stderr });
			}
		});
		let stdout = new LineSplitter({ readableObjectMode: true });
		stdout.on("data", line => { logger.verbose(line.toString()); });
		child.stdout.pipe(stdout);
		let stderr = new LineSplitter({ readableObjectMode: true });
		stderr.on("data", line => { logger.verbose(`err: ${line.toString()}`); });
		child.stderr.pipe(stderr);
	});
}

async function execMaster(args) {
	if (dev) {
		return await execFile("node", [path.join("packages", "master"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusteriomaster${scriptExt}`), args);
}

async function execSlave(args) {
	if (dev) {
		return await execFile("node", [path.join("packages", "slave"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusterioslave${scriptExt}`), args);
}

async function execCtl(args) {
	if (dev) {
		return await execFile("node", [path.join("packages", "ctl"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusterioctl${scriptExt}`), args);
}

function validateSlaveToken(token) {
	let parts = token.split(".");
	if (parts.length !== 3) {
		throw new InstallError("Invalid token");
	}

	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(parts[1], "base64"));
	} catch (err) {
		throw new InstallError("Invalid token");
	}

	if (parsed.aud !== "slave" || !Number.isInteger(parsed.slave)) {
		throw new InstallError("Invalid token");
	}
}

async function validateInstallDir() {
	let entries = new Set(await fs.readdir("."));
	if (entries.size) {
		if (!entries.has("package.json")) {
			throw new InstallError("Refusing to install to non-empty directory");
		}

		let packageData;
		try {
			packageData = JSON.parse(await fs.readFile("package.json"));
		} catch (err) {
			throw new InstallError(`Failed to read package.json: ${err.message}`);
		}
		if (packageData.name !== "clusterio-install" || !packageData.private) {
			throw new InstallError("Refusing to run on non-clusterio installation");
		}
	}
}

async function installClusterio(mode, plugins) {
	try {
		await safeOutputFile("package.json", JSON.stringify({
			name: "clusterio-install",
			private: true,
		}, null, 2), { flag: "wx" });
	} catch (err) {
		if (err.code !== "EEXIST") {
			throw new InstallError(`Failed to write package.json: ${err.message}`);
		}
	}

	let components = [];
	if (["standalone", "master"].includes(mode)) {
		components.push("@clusterio/master");
	}
	if (["standalone", "slave"].includes(mode)) {
		components.push("@clusterio/slave");
	}
	if (mode === "ctl") {
		components.push("@clusterio/ctl");
	}

	logger.info(`Please wait, installing ${mode}`);
	try {
		await execFile(`npm${scriptExt}`, ["install", ...components, ...plugins]);
	} catch (err) {
		throw new InstallError(`Failed to install: ${err.message}`);
	}

	if (plugins.length) {
		logger.info("Setting up plugins");
		let pluginList;
		try {
			pluginList = new Map(JSON.parse(await fs.readFile("plugin-list.json")));
		} catch (err) {
			if (err.code === "ENOENT") {
				pluginList = new Map();
			} else {
				throw new InstallError(`Error loading plugin-list.json: ${err.message}`);
			}
		}
		for (let plugin of plugins) {
			if (!pluginList.has(plugin)) {
				// eslint-disable-next-line node/global-require
				let pluginInfo = require(require.resolve(path.posix.join(plugin, "info"), { paths: [process.cwd()] }));
				pluginList.set(pluginInfo.name, plugin);
			}
		}
		try {
			await safeOutputFile("plugin-list.json", JSON.stringify([...pluginList], null, 4));
		} catch (err) {
			throw new InstallError(`Error writing plugin-list.json: ${err.message}`);
		}
	}
}

async function writeScripts(mode) {
	if (["standalone", "master"].includes(mode)) {
		if (process.platform === "win32") {
			await safeOutputFile(
				"run-master.cmd",
				"@echo off\n.\\node_modules\\.bin\\clusteriomaster.cmd run\n"
			);
		} else {
			await safeOutputFile(
				"run-master.sh",
				"#!/bin/sh\nexec ./node_modules/.bin/clusteriomaster run\n",
				{ mode: 0o755 },
			);
			await safeOutputFile(
				"systemd/clusteriomaster.service",
				`[Unit]
Description=Clusterio Master

[Service]
User=${os.userInfo().username}
Group=nogroup
WorkingDirectory=${process.cwd()}
KillMode=mixed
KillSignal=SIGINT
ExecStart=${process.cwd()}/node_modules/.bin/clusteriomaster run --log-level=warn

[Install]
WantedBy=multi-user.target
`);
		}
	}

	if (["standalone", "slave"].includes(mode)) {
		if (process.platform === "win32") {
			await safeOutputFile(
				"run-slave.cmd",
				"@echo off\n.\\node_modules\\.bin\\clusterioslave.cmd run\n"
			);
		} else {
			await safeOutputFile(
				"run-slave.sh",
				"#!/bin/sh\nexec ./node_modules/.bin/clusterioslave run\n",
				{ mode: 0o755 },
			);
			await safeOutputFile(
				"systemd/clusterioslave.service",
				`[Unit]
Description=Clusterio Slave

[Service]
User=${os.userInfo().username}
Group=nogroup
WorkingDirectory=${process.cwd()}
KillMode=mixed
KillSignal=SIGINT
ExecStart=${process.cwd()}/node_modules/.bin/clusterioslave run --log-level=warn

[Install]
WantedBy=multi-user.target
`);
		}
	}
}

// eslint-disable-next-line complexity
async function inquirerMissingArgs(args) {
	let answers = {};
	if (args.mode) { answers.mode = args.mode; }
	answers = await inquirer.prompt([
		{
			type: "list",
			name: "mode",
			message: "Operating mode to install",
			default: "standalone",
			choices: [
				{ name: "Standalone (install both master and slave on this computer)", value: "standalone" },
				{ name: "Master only", value: "master" },
				{ name: "Slave only", value: "slave" },
				{ name: "Ctl only", value: "ctl" },
				{ name: "Plugins only", value: "plugins" },
			],
		},
	], answers);

	if (["standalone", "master"].includes(answers.mode)) {
		if (args.admin) { answers.admin = args.admin; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "admin",
				message: "Admin account name",
				validate: input => {
					if (!input) {
						return "May not be empty";
					}
					return true;
				},
			},
		], answers);
	}

	if (answers.mode === "slave") {
		if (args.slaveName) { answers.slaveName = args.slaveName; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "slaveName",
				message: "Name of slave",
			},
		], answers);
	}

	if (["slave", "ctl"].includes(answers.mode)) {
		if (args.masterUrl) { answers.masterUrl = args.masterUrl; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "masterUrl",
				message: "Master server URL",
			},
		], answers);

		if (args.masterToken) { answers.masterToken = args.masterToken; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "masterToken",
				message: "Master authentication Token",
			},
		], answers);
	}

	if (answers.mode === "slave") {
		validateSlaveToken(answers.masterToken);
	}

	if (["standalone", "slave"].includes(answers.mode)) {
		let myIp = "localhost";
		if (args.publicAddress) {
			answers.publicAddress = args.publicAddress;
		} else {
			try {
				let result = await phin("https://api.ipify.org/");
				myIp = result.body.toString();
			} catch (err) { /* ignore */ }
		}
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "publicAddress",
				message: "Public DNS/IP address of this server",
				default: myIp,
			},
		], answers);

		if (args.factorioDir) { answers.factorioDir = args.factorioDir; }
		let locations = factorioLocations[process.platform] || [];
		let foundLocations = [];
		for (let location of locations) {
			if (await fs.pathExists(path.join(location, "data", "changelog.txt"))) {
				foundLocations.push(location);
			}
		}
		if (process.platform === "linux") {
			if (args.hasOwnProperty("downloadHeadless")) { answers.downloadHeadless = args.downloadHeadless; }

			answers = await inquirer.prompt([
				{
					type: "confirm",
					name: "downloadHeadless",
					message: "(Linux only) Automatically download latest factorio release?",
					default: true,
				},
			], answers);

			if (answers.downloadHeadless) {
				answers.factorioDir = "factorio";
			}
		}

		answers = await inquirer.prompt([
			{
				type: "list",
				name: "factorioDir",
				message: "Path to Factorio installation",
				choices: [
					...foundLocations.map(location => ({ name: `${location} (auto detected)`, value: location })),
					{ name: "Use local factorio directory, you must copy an installation to it", value: "factorio" },
					{ name: "Provide path manually", value: null },
				],
			},
		], answers);

		if (answers.factorioDir === null) {
			answers = await inquirer.prompt([
				{
					type: "input",
					name: "factorioDir",
					message: "Path to Factorio installation",
					askAnswered: true,
				},
			], answers);
		} else if (answers.factorioDir === "factorio") {
			await fs.ensureDir("factorio");
		}
	}

	if (dev) {
		answers.plugins = [];
	} else if (args.plugins) {
		answers.plugins = args.plugins;
	}
	answers = await inquirer.prompt([
		{
			type: "checkbox",
			name: "plugins",
			message: "Plugins to install",
			choices: availablePlugins,
			pageSize: 20,
		},
	], answers);

	return answers;
}

async function downloadLinuxServer() {
	let res = await phin("https://factorio.com/get-download/stable/headless/linux64");

	const url = new URL(res.headers.location);
	// get the filename of the latest factorio archive from redirected url
	const filename = path.posix.basename(url.pathname);
	const version = filename.match(/(?<=factorio_headless_x64_).*(?=\.tar\.xz)/)[0];

	const tmpDir = "temp/create-temp/";
	const archivePath = tmpDir + filename;
	const tmpArchivePath = `${archivePath}.tmp`;
	const factorioDir = `factorio/${version}/`;
	const tmpFactorioDir = tmpDir + version;

	if (await fs.pathExists(factorioDir)) {
		logger.warn(`setting downloadDir to ${factorioDir}, but not downloading because already existing`);
	} else {
		await fs.ensureDir(tmpDir);

		// follow the redirect
		res = await phin({
			url: url.href,
			stream: true,
		});

		logger.info("Downloading latest Factorio server release. This may take a while.");
		const writeStream = fs.createWriteStream(tmpArchivePath);
		res.pipe(writeStream);

		await events.once(res, "end");

		await fs.rename(tmpArchivePath, archivePath);
		try {
			await fs.ensureDir(tmpFactorioDir);
			await execFile("tar", [
				"xf", archivePath, "-C", tmpFactorioDir, "--strip-components", "1",
			]);
		} catch (e) {
			logger.error("error executing command- do you have 'xz-utils' installed?");
			throw e;
		}

		await fs.unlink(archivePath);
		await fs.rename(tmpFactorioDir, factorioDir);
	}
}

async function main() {
	let args = yargs
		.option("log-level", {
			nargs: 1, describe: "Log level to print to stdout", default: "info",
			choices: ["none"].concat(Object.keys(levels)), type: "string",
		})
		.option("dev", {
			nargs: 0, describe: "Initialize development repository", hidden: true, default: false, type: "boolean",
		})
		.option("mode", {
			nargs: 1, describe: "Operating mode to install",
			choices: ["standalone", "master", "slave", "ctl", "plugins"],
		})
		.option("admin", {
			nargs: 1, describe: "Admin account name [standalone/master]", type: "string",
		})
		.option("slave-name", {
			nargs: 1, describe: "Slave name [slave]", type: "string",
		})
		.option("master-url", {
			nargs: 1, describe: "Master URL [slave/ctl]", type: "string",
		})
		.option("master-token", {
			nargs: 1, describe: "Master authentication token [slave/ctl]", type: "string",
		})
		.option("public-address", {
			nargs: 1, describe: "DNS/IP Address to connect to this server [standalone/slave]", type: "string",
		})
		.option("factorio-dir", {
			nargs: 1, describe: "Path to Factorio installation [standalone/slave]", type: "string",
		})
		.option("plugins", {
			array: true, describe: "Plugins to install", type: "string",
		});

	if (process.platform === "linux") {
		args = args
			.option("download-headless", {
				nargs: 0,
				describe: "(Linux only) Automatically download and unpack the latest factorio release. " +
					"Can be set to false using --no-download-headless.",
				type: "boolean",
			})
			.conflicts("factorio-dir", "download-headless");
	}

	args = args.argv;

	setLogLevel(args.logLevel === "none" ? -1 : levels[args.logLevel]);
	dev = args.dev;

	if (!dev) {
		await validateInstallDir();
	}

	let answers = await inquirerMissingArgs(args);
	if (answers.downloadHeadless) {
		await downloadLinuxServer();
	}

	logger.verbose(JSON.stringify(answers));

	if (!dev) {
		await installClusterio(answers.mode, answers.plugins);
	}

	let adminToken = null;
	if (["standalone", "master"].includes(answers.mode)) {
		logger.info("Setting up master");
		await execMaster(["bootstrap", "create-admin", answers.admin]);
		let result = await execMaster(["bootstrap", "generate-user-token", answers.admin]);
		adminToken = result.stdout.split("\n").slice(-2)[0];
	}

	if (answers.mode === "standalone") {
		logger.info("Setting up slave");
		await execSlave(["config", "set", "slave.name", "local"]);

		let result = await execSlave(["config", "show", "slave.id"]);
		let slaveId = Number.parseInt(result.stdout.split("\n").slice(-2)[0], 10);

		result = await execMaster(["bootstrap", "generate-slave-token", slaveId]);
		let slaveToken = result.stdout.split("\n").slice(-2)[0];

		await execSlave(["config", "set", "slave.master_token", slaveToken]);
		await execSlave(["config", "set", "slave.public_address", answers.publicAddress]);
		await execSlave(["config", "set", "slave.factorio_directory", answers.factorioDir]);
	}

	if (answers.mode === "slave") {
		logger.info("Setting up slave");
		let slaveId = JSON.parse(Buffer.from(answers.masterToken.split(".")[1], "base64")).slave;
		await execSlave(["config", "set", "slave.id", slaveId]);
		await execSlave(["config", "set", "slave.name", answers.slaveName]);
		await execSlave(["config", "set", "slave.master_url", answers.masterUrl]);
		await execSlave(["config", "set", "slave.master_token", answers.masterToken]);
		await execSlave(["config", "set", "slave.public_address", answers.publicAddress]);
		await execSlave(["config", "set", "slave.factorio_directory", answers.factorioDir]);
	}

	if (!dev && ["standalone", "master", "slave"].includes(answers.mode)) {
		logger.info("Writing run scripts");
		await writeScripts(answers.mode);
	}

	if (answers.mode === "ctl") {
		await execCtl(["control-config", "set", "control.master_url", answers.masterUrl]);
		await execCtl(["control-config", "set", "control.master_token", answers.masterToken]);
	}

	/* eslint-disable no-console */
	console.log(`Successfully installed ${answers.mode}`);
	if (adminToken) {
		console.log(`Admin authentication token: ${adminToken}`);
	}
	/* eslint-enable no-console */
}

if (module === require.main) {
	main().catch(err => {
		if (err instanceof InstallError) {
			logger.error(err.message);
		} else {
			logger.fatal(`
+------------------------------------------------------------+
| Unexpected error occured installing clusterio, please      |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
		}
	});
}
