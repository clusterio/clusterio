#!/usr/bin/env node

import child_process from "node:child_process";
import fs from "node:fs/promises";
import inquirer from "inquirer";
import os from "node:os";
import path from "node:path";
import stream from "node:stream";
import util from "node:util";
import yargs from "yargs";

import { levels, logger, setLogLevel } from "./logging.js";
import { checkHostToken, createLocalHost, pairHost, PairingError } from "./pair.js";
import { copyPluginTemplates } from "./template.js";
let dev = false;
const scriptExt = process.platform === "win32" ? ".cmd" : "";
import { escapeArg } from "./escape_arg.js";

// I hate this, there is a bug with rl.close on windows that was meant to have been fixed in Node14.4
// See nodejs/node#21771 and nodejs/node#30701 for the apparent fix that was applied
// One option is to not call rl.close: SBoudrias/Inquirer.js#767
// But this comes with its own issues: SBoudrias/Inquirer.js#899
// The solution below was adapted from aws-amplify/amplify-cli#12347
if (process.platform === "win32") {
	const _inquirer_close = inquirer.ui.Prompt.prototype.close;
	inquirer.ui.Prompt.prototype.close = function() {
		this.rl.terminal = false;
		_inquirer_close.call(this);
	};
}

const availablePlugins = [
	{ name: "Global Chat", value: "@clusterio/plugin-global_chat" },
	{ name: "Player Auth", value: "@clusterio/plugin-player_auth" },
	{ name: "Player Sync", value: "@clusterio/plugin-player_sync" },
	{ name: "Research Sync", value: "@clusterio/plugin-research_sync" },
	{ name: "Statistics Exporter", value: "@clusterio/plugin-statistics_exporter" },
	{ name: "Subspace Storage", value: "@clusterio/plugin-subspace_storage" },
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

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
	} catch (err) {
		if (err.code === "ENOENT" || err.code === "ENOTDIR") {
			return false;
		}
	}
	return true;
}

async function safeOutputFile(file, data, options={}) {
	let { dir, name, ext } = path.parse(file);
	let temporary = path.join(dir, `${name}.tmp${ext}`);
	if (dir) {
		await fs.mkdir(dir, { recursive: true });
	}
	await fs.writeFile(temporary, data, { ...options, flush: true });
	await fs.rename(temporary, file);
}

async function execFile(cmd, args) {
	const command = [cmd, ...args.map(escapeArg)].join(" ");
	logger.verbose(`executing ${command}`);
	return new Promise((resolve, reject) => {
		let child = child_process.execFile(
			command,
			{
				shell: true,

				env: process.platform === "win32" ? { ...process.env, pct: "%" } : undefined,
			},
			(err, stdout, stderr) => {
				if (err) {
					reject(err);
				} else {
					resolve({ stdout, stderr });
				}
			}
		);
		let stdout = new LineSplitter({ readableObjectMode: true });
		stdout.on("data", line => { logger.verbose(line.toString()); });
		child.stdout.pipe(stdout);
		let stderr = new LineSplitter({ readableObjectMode: true });
		stderr.on("data", line => { logger.verbose(`err: ${line.toString()}`); });
		child.stderr.pipe(stderr);
	});
}

async function execController(args) {
	if (dev) {
		return await execFile("node", [path.join(import.meta.dirname, "..", "controller"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusteriocontroller${scriptExt}`), args);
}

async function execHost(args) {
	if (dev) {
		return await execFile("node", [path.join(import.meta.dirname, "..", "host"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusteriohost${scriptExt}`), args);
}

async function execCtl(args) {
	if (dev) {
		return await execFile("node", [path.join(import.meta.dirname, "..", "ctl"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusterioctl${scriptExt}`), args);
}

function validateHostName(input) {
	if (!input || !input.trim()) {
		return "Host name may not be empty";
	}
	if (input.trim().length > 100) {
		return "Host name may be at most 100 characters";
	}
	if (hostNameControlCharacters.test(input)) {
		return "Host name may not contain control characters";
	}
	return true;
}

// Same characters as the controller refuses in host names.
const hostNameControlCharacters = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

function validateControllerUrl(input) {
	let url;
	try {
		url = new URL(input);
	} catch (err) {
		return "Controller URL must be a URL like https://example.com/";
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		return "Controller URL must start with http:// or https://";
	}
	return true;
}

// The host requires the controller URL to end with a slash.
function normaliseControllerUrl(input) {
	const url = new URL(input);
	if (!url.pathname.endsWith("/")) {
		url.pathname += "/";
	}
	return url.href;
}

async function readSelfSignedCert(args) {
	if (!args.selfSignedCert) {
		return undefined;
	}
	try {
		return await fs.readFile(args.selfSignedCert);
	} catch (err) {
		throw new InstallError(`Failed to read --self-signed-cert ${args.selfSignedCert}: ${err.message}`);
	}
}

async function installerVersion() {
	return JSON.parse(await fs.readFile(path.join(import.meta.dirname, "package.json"))).version;
}

// Remote updates, plugin updates and plugin installs are allowed or denied together.
async function setRemoteUpdates(exec, component, allow) {
	for (let field of ["allow_remote_updates", "allow_plugin_updates", "allow_plugin_install"]) {
		await exec(["config", "set", `${component}.${field}`, allow]);
	}
}

// Turn an error from pairing into a message for the user.
function pairingFailed(err) {
	const retry = "Run the installer again with --mode host in this directory to retry.";
	if (err.name === "AbortError") {
		return new InstallError(`Pairing cancelled. ${retry}`);
	}
	if (err instanceof PairingError) {
		return new InstallError(`Pairing failed: ${err.message}. ${retry}`);
	}
	if (typeof err.code === "string") {
		const hint = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(err.code)
			? " Pass the certificate with --self-signed-cert if the controller uses a self-signed one."
			: "";
		return new InstallError(`Failed to connect to the controller: ${err.message}.${hint} ${retry}`);
	}
	return err;
}

// Request to join the cluster and save the id and token of the host once approved.
async function pairWithController(args, { hostName, controllerUrl }) {
	const ca = await readSelfSignedCert(args);
	await execHost(["config", "set", "host.name", hostName]);
	await execHost(["config", "set", "host.controller_url", controllerUrl]);

	// Ctrl-C may arrive twice under npm init, as npm forwards it to the installer, so keep
	// listening until the request has been cancelled.
	const abort = new AbortController();
	const onSigint = () => { abort.abort(); };
	process.on("SIGINT", onSigint);
	// The close patch for inquirer on Windows leaves the console in raw mode, where Ctrl-C is
	// read as input instead of raising SIGINT. No prompts follow, so it can be turned off.
	if (process.platform === "win32" && process.stdin.isTTY && process.stdin.isRaw) {
		process.stdin.setRawMode(false);
	}
	let result;
	try {
		logger.info(`Requesting to join the cluster at ${controllerUrl}`);
		result = await pairHost({
			controllerUrl,
			name: hostName,
			version: await installerVersion(),
			token: args.controllerToken,
			ca,
			signal: abort.signal,
			onPending: ({ code }) => {
				// eslint-disable-next-line no-console
				console.log(
					`Waiting for approval. Approve "${hostName}" with code ${code} on the Hosts page of ` +
					`${controllerUrl}, or run: npx clusterioctl host approve ${code}`
				);
			},
		});
	} catch (err) {
		throw pairingFailed(err);
	} finally {
		process.off("SIGINT", onSigint);
	}

	logger.info(`Host approved as "${result.name}" with id ${result.hostId}`);
	await execHost(["config", "set", "host.id", result.hostId]);
	if (result.name !== hostName) {
		await execHost(["config", "set", "host.name", result.name]);
	}
	// Saved last so that an interrupted install is paired again when the installer is run again.
	await execHost(["config", "set", "host.controller_token", result.token]);
}

// Pair a host that is already installed again, unless the controller still accepts it.
async function rerunHost(args) {
	let config;
	try {
		config = JSON.parse(await fs.readFile("config-host.json"));
	} catch (err) {
		throw new InstallError(`Failed to read config-host.json: ${err.message}`);
	}
	// Let a rerun fix run scripts written before the certificate was passed.
	if (!dev && args.selfSignedCert) {
		logger.info("Writing run scripts");
		await writeScripts("host", args.selfSignedCert);
	}
	if (!args.pair) {
		// eslint-disable-next-line no-console
		console.log("Host is already installed");
		return;
	}

	const token = config["host.controller_token"];
	const controllerUrl = config["host.controller_url"];
	let otherController = false;
	if (args.controllerUrl !== undefined) {
		const result = validateControllerUrl(args.controllerUrl);
		if (result !== true) {
			throw new InstallError(result);
		}
		const savedUrl = validateControllerUrl(controllerUrl) === true ? normaliseControllerUrl(controllerUrl) : "";
		otherController = normaliseControllerUrl(args.controllerUrl) !== savedUrl;
	}
	// The token is never sent to another controller, it would give that controller access to this cluster.
	if (otherController) {
		logger.info(`Pairing with ${args.controllerUrl} instead of the controller in config-host.json`);
	} else if (token && token !== "enter token here") {
		let valid;
		try {
			valid = await checkHostToken({ controllerUrl, token, ca: await readSelfSignedCert(args) });
		} catch (err) {
			if (err instanceof InstallError) {
				throw err;
			}
			logger.warn(`Could not check if ${controllerUrl} accepts this host: ${err.message}`);
			logger.warn("Keeping the existing host config, pass --controller-url to pair with another controller");
			return;
		}
		if (valid) {
			// eslint-disable-next-line no-console
			console.log("Host is already set up");
			return;
		}
		logger.info("The controller no longer accepts this host, pairing it again");
	}

	const answers = await inquirerPairingArgs(args, {
		hostName: config["host.name"],
		controllerUrl: config["host.controller_url"],
	});
	await pairWithController(args, answers);
	// eslint-disable-next-line no-console
	console.log("Successfully set up host");
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

async function validateNotRoot(args) {
	if (args.allowInstallAsRoot) {
		return;
	}

	if (os.userInfo().uid === 0) {
		throw new InstallError(
			"Refusing to install as root. Create a separate user account for clusterio " +
			"and then use su/sudo to switch to it before invoking the installer."
		);
	}
}

async function migrateRename(args) {
	function rename(string) {
		return string.replace(/master/g, "controller").replace(/slave/g, "host");
	}

	function renameConfig(config) {
		for (let group of config["groups"]) {
			group["name"] = rename(group["name"]);
			group["fields"] = Object.fromEntries(
				Object.entries(group["fields"]).map(([k, v]) => [rename(k), v])
			);
		}
		return config;
	}

	async function migrateConfig(source, destination) {
		if (await pathExists(source) && !await pathExists(destination)) {
			await safeOutputFile(destination, JSON.stringify(
				renameConfig(JSON.parse(await fs.readFile(source))), null, "\t"
			), { mode: 0o600 });
			logger.info(`Migrated ${source} to ${destination}`);
		}
	}

	await migrateConfig("config-master.json", "config-controller.json");
	await migrateConfig("config-slave.json", "config-host.json");

	let instancesFile = path.join("database", "instances.json");
	if (await pathExists(instancesFile)) {
		await safeOutputFile(instancesFile, JSON.stringify(
			JSON.parse(await fs.readFile(instancesFile)).map(renameConfig), null, "\t"
		));
		logger.info(`Migrated ${instancesFile}`);
	}

	let usersFile = path.join("database", "users.json");
	if (await pathExists(usersFile)) {
		let users = JSON.parse(await fs.readFile(usersFile));
		for (let role of users["roles"]) {
			role["permissions"] = role["permissions"].map(rename);
		}
		await safeOutputFile(usersFile, JSON.stringify(users, null, "\t"));
		logger.info(`Migrated ${usersFile}`);
	}

	function renameLogLine(info) {
		return Object.fromEntries(
			Object.entries(info).map(([k, v]) => [rename(k), v])
		);
	}

	async function migrateLog(inputFile, outputFile) {
		let lineStream = new LineSplitter({ readableObjectMode: true });
		let fileStream = (await fs.open(inputFile)).createReadStream();
		fileStream.pipe(lineStream);
		let lines = [];

		for await (let inputLine of lineStream) {
			try {
				lines.push(Buffer.from(JSON.stringify(renameLogLine(JSON.parse(inputLine)))));
				lines.push(Buffer.from("\n"));
			} catch (err) {
				if (!(err instanceof SyntaxError)) {
					throw err;
				}
				logger.warn(`Invalid log line: ${inputLine.toString()}`);
				lines.push(inputLine);
			}
		}
		safeOutputFile(outputFile, Buffer.concat(lines));
	}

	async function migrateLogsDir(inputLogs, outputLogs) {
		if (await pathExists(inputLogs)) {
			logger.info(`Migrating ${inputLogs} to ${outputLogs}`);
			for (let logFile of await fs.readdir(inputLogs)) {
				if (!logFile.endsWith(".log")) {
					continue;
				}
				let inputFile = path.join(inputLogs, logFile);
				let outputFile = path.join(outputLogs, rename(logFile));
				if (!await pathExists(outputFile)) {
					await migrateLog(inputFile, outputFile);
					logger.verbose(`Migrated ${inputFile} to ${outputFile}`);
				}
			}
		}
	}

	await migrateLogsDir(path.join("logs", "master"), path.join("logs", "controller"));
	await migrateLogsDir(path.join("logs", "slave"), path.join("logs", "host"));
	if (
		await pathExists(path.join("logs", "cluster"))
		&& !await pathExists(path.join("logs", "cluster-prerename"))
	) {
		await fs.rename(path.join("logs", "cluster"), path.join("logs", "cluster-prerename"));
		await migrateLogsDir(path.join("logs", "cluster-prerename"), path.join("logs", "cluster"));
	}

	if (
		await pathExists("sharedMods")
		&& !await pathExists("mods")
	) {
		logger.info("Moving sharedMods/ to mods/");
		await fs.rename("sharedMods", "mods");
	}

	if (!args.dev) {
		let pkg = JSON.parse(await fs.readFile("package.json"));
		if (pkg.dependencies) {
			let convert = ["@clusterio/master", "@clusterio/slave"];
			let uninstall = convert.filter(c => pkg.dependencies[c] !== undefined);
			let install = uninstall.map(rename);
			if (uninstall.length) {
				logger.info(`Replacing ${uninstall.join(" and ")}`);
				await execFile(`npm${scriptExt}`, ["install", ...install]);
				await execFile(`npm${scriptExt}`, ["uninstall", ...uninstall]);
			}
		}
		logger.info("Updating packages");
		await execFile(`npm${scriptExt}`, ["update"]);
	}

	const hasRunMaster = await pathExists("run-master.sh") || await pathExists("run-master.cmd");
	const hasRunSlave = await pathExists("run-slave.sh") || await pathExists("run-slave.cmd");
	if (hasRunMaster || hasRunSlave) {
		logger.info("Writing run scripts");
		let mode = "standalone";
		if (!hasRunSlave) { mode = "controller"; }
		if (!hasRunMaster) { mode = "host"; }
		await writeScripts(mode, "");
	}

	logger.info(
		"Migration complete, you may now delete the following left over files and directories (if present):" +
		"\n- config-master.json" +
		"\n- config-slave.json" +
		"\n- logs/master" +
		"\n- logs/slave" +
		"\n- logs/cluster-prerename" +
		"\n- systemd/clusteriomaster.service" +
		"\n- systemd/clusterioslave.service" +
		"\n- run-master.sh / run-master.cmd" +
		"\n- run-slave.sh / run-slave.cmd"
	);
}

async function installClusterio(mode, plugins) {
	try {
		await fs.writeFile("package.json", JSON.stringify({
			name: "clusterio-install",
			private: true,
		}, null, 2), { flag: "wx" });
	} catch (err) {
		if (err.code !== "EEXIST") {
			throw new InstallError(`Failed to write package.json: ${err.message}`);
		}
	}

	let components = [];
	if (["standalone", "controller"].includes(mode)) {
		components.push("@clusterio/controller");
	}
	if (["standalone", "host"].includes(mode)) {
		components.push("@clusterio/host");
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

	// Controller, host and ctl discover installed plugins when loading their configuration.
}

async function groupIdToName(gid) {
	try {
		let exec = util.promisify(child_process.exec);
		let { stdout } = await exec(`getent group ${gid}`);
		return stdout.split(":")[0];
	} catch (err) {
		logger.warn(`getent group ${gid} failed: ${err.message}`);
		return gid;
	}
}

async function writeScripts(mode, selfSignedCert) {
	if (["standalone", "controller"].includes(mode)) {
		if (process.platform === "win32") {
			await safeOutputFile(
				"run-controller.cmd",
				`\
@echo off
set "NODE_OPTIONS=--enable-source-maps %NODE_OPTIONS%"
:restart
call .\\node_modules\\.bin\\clusteriocontroller.cmd run --can-restart
if %errorlevel% equ 0 exit /b
if %errorlevel% equ 8 exit /b
goto restart
`
			);
		} else {
			await safeOutputFile(
				"run-controller.sh",
				`\
#!/bin/bash
export "NODE_OPTIONS=--enable-source-maps $NODE_OPTIONS"
while true; do
	./node_modules/.bin/clusteriocontroller run --can-restart
	if [[ $? -eq 0 || $? -eq 8 ]]; then exit $?; fi
done
`,
				{ mode: 0o755 },
			);
			await safeOutputFile(
				"systemd/clusteriocontroller.service",
				`\
[Unit]
Description=Clusterio Controller

[Service]
User=${os.userInfo().username}
Group=${await groupIdToName(os.userInfo().gid)}
WorkingDirectory=${process.cwd()}
KillMode=mixed
KillSignal=SIGINT
Environment=NODE_OPTIONS=--enable-source-maps
ExecStart=${process.cwd()}/node_modules/.bin/clusteriocontroller run --log-level=warn --can-restart
Restart=on-failure
RestartPreventExitStatus=8

[Install]
WantedBy=multi-user.target
`
			);
		}
	}

	if (["standalone", "host"].includes(mode)) {
		if (process.platform === "win32") {
			let extraCaCertsLine = selfSignedCert ? `set "NODE_EXTRA_CA_CERTS=${selfSignedCert}"\n` : "";
			await safeOutputFile(
				"run-host.cmd",
				`\
@echo off
set "NODE_OPTIONS=--enable-source-maps %NODE_OPTIONS%"
${extraCaCertsLine}:restart
call .\\node_modules\\.bin\\clusteriohost.cmd run --can-restart
if %errorlevel% equ 0 exit /b
if %errorlevel% equ 8 exit /b
goto restart
`
			);
		} else {
			let extraCaCertsLine = selfSignedCert ? `export "NODE_EXTRA_CA_CERTS=${selfSignedCert}"\n` : "";
			await safeOutputFile(
				"run-host.sh",
				`\
#!/bin/bash
export "NODE_OPTIONS=--enable-source-maps $NODE_OPTIONS"
${extraCaCertsLine}while true; do
	./node_modules/.bin/clusteriohost run --can-restart
	if [[ $? -eq 0 || $? -eq 8 ]]; then exit $?; fi
done
`,
				{ mode: 0o755 },
			);
			extraCaCertsLine = selfSignedCert ? `Environment=NODE_EXTRA_CA_CERTS=${selfSignedCert}\n` : "";
			await safeOutputFile(
				"systemd/clusteriohost.service",
				`\
[Unit]
Description=Clusterio Host

[Service]
User=${os.userInfo().username}
Group=${await groupIdToName(os.userInfo().gid)}
WorkingDirectory=${process.cwd()}
KillMode=mixed
KillSignal=SIGINT
Environment=NODE_OPTIONS=--enable-source-maps
${extraCaCertsLine}ExecStart=${process.cwd()}/node_modules/.bin/clusteriohost run --log-level=warn --can-restart
Restart=on-failure
RestartPreventExitStatus=8

[Install]
WantedBy=multi-user.target
`
			);
		}
	}
}

async function inquirerPairingArgs(args, defaults = {}) {
	let answers = {};
	if (args.hostName) { answers.hostName = args.hostName; }
	if (args.controllerUrl) { answers.controllerUrl = args.controllerUrl; }
	answers = await inquirer.prompt([
		{
			type: "input",
			name: "hostName",
			message: "Name of host",
			default: defaults.hostName ?? os.hostname(),
			validate: validateHostName,
		},
		{
			type: "input",
			name: "controllerUrl",
			message: "Controller URL",
			default: defaults.controllerUrl,
			validate: validateControllerUrl,
		},
	], answers);

	// Inquirer does not validate answers given as arguments
	for (let result of [validateHostName(answers.hostName), validateControllerUrl(answers.controllerUrl)]) {
		if (result !== true) {
			throw new InstallError(result);
		}
	}
	answers.controllerUrl = normaliseControllerUrl(answers.controllerUrl);
	return answers;
}

// eslint-disable-next-line complexity
async function inquirerMissingArgs(args) {
	let answers = {};
	if (args.mode) { answers.mode = args.mode; }
	if (args["plugin-template"]) { answers.mode = "plugin-template"; }
	answers = await inquirer.prompt([
		{
			type: "list",
			name: "mode",
			message: "Operating mode to install",
			default: "standalone",
			choices: [
				{ name: "Standalone (install both controller and host on this computer)", value: "standalone" },
				{ name: "Controller only", value: "controller" },
				{ name: "Host only", value: "host" },
				{ name: "Ctl only", value: "ctl" },
				{ name: "Plugins only", value: "plugins" },
				{ name: "Plugin template", value: "plugin-template" },
			],
		},
	], answers);

	if (["standalone", "controller"].includes(answers.mode)) {
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

		if (args.httpPort) { answers.httpPort = args.httpPort; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "httpPort",
				message: "HTTP port to listen on",
				default: 8080,
				validate: input => {
					if (!input) {
						return "May not be empty";
					}
					if (!Number.isInteger(Number(input))) {
						return "Must be a number";
					}
					return true;
				},
			},
		], answers);
	}

	if (answers.mode === "host") {
		if (await pathExists("config-host.json")) {
			// An installed host is only paired again, see rerunHost
			return { mode: "host", rerun: true };
		}
		if (args.pair) {
			answers = { ...answers, ...await inquirerPairingArgs(args) };
		}
	}

	if (answers.mode === "ctl") {
		if (args.controllerUrl) { answers.controllerUrl = args.controllerUrl; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "controllerUrl",
				message: "Controller URL",
			},
		], answers);

		if (args.controllerToken) { answers.controllerToken = args.controllerToken; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "controllerToken",
				message: "Controller authentication Token",
			},
		], answers);
	}

	if (["standalone", "host"].includes(answers.mode)) {
		let myIp = "localhost";
		if (args.publicAddress) {
			answers.publicAddress = args.publicAddress;
		} else {
			try {
				let result = await fetch("https://api.ipify.org/");
				myIp = await result.text();
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
			if (await pathExists(path.join(location, "data", "changelog.txt"))) {
				foundLocations.push(location);
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
			await fs.mkdir("factorio", { recursive: true });
		}
	}

	if (["standalone", "controller", "host"].includes(answers.mode)) {
		if (args.hasOwnProperty("remoteNpm")) { answers.remoteNpm = args.remoteNpm; }
		answers = await inquirer.prompt([
			{
				type: "confirm",
				name: "remoteNpm",
				message: "Allow remote updates and plugin installs from the web interface?",
				default: true,
			},
		], answers);
	}

	if (answers.mode === "plugin-template") {
		if (args["plugin-template"] && args["plugin-template"].length > 0) {
			answers.pluginTemplate = args["plugin-template"];
		}
		if (args["plugin-name"]) {
			answers.pluginName = args["plugin-name"];
		}
		answers.plugins = [];
		answers = await inquirer.prompt([
			{
				type: "checkbox",
				name: "pluginTemplate",
				message: "Plugin templates to use",
				choices: [
					{ name: "Controller", value: "controller" },
					{ name: "Host", value: "host" },
					{ name: "Instance", value: "instance" },
					{ name: "Lua Module", value: "module" },
					{ name: "Command Line", value: "ctl" },
					{ name: "Web UI", value: "web" },
					{ name: "No Typescript", value: "js" },
					{ name: "No Config", value: "no_config" },
				],
			},
			{
				type: "input",
				name: "pluginName",
				message: "Name of your new plugin",
				default: path.basename(path.resolve()),
			},
		], answers);
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

async function main() {
	let yarg = yargs(process.argv.slice(2))
		.option("log-level", {
			nargs: 1, describe: "Log level to print to stdout", default: "info",
			choices: ["none"].concat(Object.keys(levels)), type: "string",
		})
		.option("dev", {
			nargs: 0, describe: "Initialize development repository", hidden: true, default: false, type: "boolean",
		})
		.option("mode", {
			nargs: 1, describe: "Operating mode to install",
			choices: ["standalone", "controller", "host", "ctl", "plugins", "plugin-template"],
		})
		.option("migrate-rename", {
			nargs: 0, describe: "Migrate from before slave/master rename", default: false, type: "boolean",
		})
		.option("admin", {
			nargs: 1, describe: "Admin account name [standalone/controller]", type: "string",
		})
		.option("http-port", {
			nargs: 1, describe: "HTTP port to listen on [standalone/controller]", type: "number",
		})
		.option("host-name", {
			nargs: 1, describe: "Host name [host]", type: "string",
		})
		.option("controller-url", {
			nargs: 1, describe: "Controller URL [host/ctl]", type: "string",
		})
		.option("controller-token", {
			nargs: 1, type: "string", describe:
				"User token for ctl, or of a user that approves the host without waiting (not saved) [host/ctl]",
		})
		.option("pair", {
			describe: "Pair the host with the controller, use --no-pair to only install it [host]",
			default: true, type: "boolean",
		})
		.option("public-address", {
			nargs: 1, describe: "DNS/IP Address to connect to this server [standalone/host]", type: "string",
		})
		.option("factorio-dir", {
			nargs: 1, describe: "Path to Factorio installation [standalone/host]", type: "string",
		})
		.option("self-signed-cert", {
			nargs: 1, describe: "Path to self-signed certificate of the controller [standalone/host]", type: "string",
		})
		.option("remote-npm", {
			nargs: 0, type: "boolean", description:
				"Allow remote updates and plugin installs from the web interface [standalone/controller/host]",
		})
		.option("plugins", {
			array: true, describe: "Plugins to install", type: "string",
		})
		.option("plugin-template", {
			array: true, describe: "Plugin template to use [plugin-template]", type: "string",
		})
		.option("plugin-name", {
			nargs: 1, describe: "Name of your new plugin [plugin-template]", type: "string",
		})
		.strict()
	;

	if (process.platform === "linux") {
		yarg = yarg
			.option("allow-install-as-root", {
				nargs: 0, describe: "(Linux only) Allow installing as root (not recommended)", type: "boolean",
			})
		;
	}

	const args = yarg.parse();

	setLogLevel(args.logLevel === "none" ? -1 : levels[args.logLevel]);
	dev = args.dev;

	if (!dev) {
		await validateInstallDir();
		await validateNotRoot(args);
	}

	if (args.migrateRename) {
		await migrateRename(args);
		return;
	}

	let answers = await inquirerMissingArgs(args);
	logger.verbose(JSON.stringify(answers));

	if (answers.rerun) {
		await rerunHost(args);
		return;
	}

	if (answers.pluginTemplate) {
		await copyPluginTemplates(answers.pluginName, answers.pluginTemplate);
		return;
	}

	if (!dev) {
		await installClusterio(answers.mode, answers.plugins);
	}

	let adminToken = null;
	if (["standalone", "controller"].includes(answers.mode)) {
		logger.info("Setting up controller");
		await execController(["config", "create"]);
		await execController(["bootstrap", "create-admin", answers.admin]);
		await execController(["config", "set", "controller.http_port", answers.httpPort]);
		await setRemoteUpdates(execController, "controller", answers.remoteNpm);
		let result = await execController(["bootstrap", "generate-user-token", answers.admin]);
		adminToken = result.stdout.split("\n").slice(-2)[0];
	}

	if (["standalone", "host"].includes(answers.mode)) {
		logger.info("Setting up host");
		await execHost(["config", "create"]);
	}

	if (answers.mode === "standalone") {
		// The controller is not running, so the host is added to its database directly. The id
		// from the host config is kept so running the installer again reuses the same host.
		let result = await execHost(["config", "show", "host.id"]);
		let hostId = Number.parseInt(result.stdout.split("\n").slice(-2)[0], 10);
		let host = await createLocalHost({ name: "local", id: Number.isInteger(hostId) ? hostId : undefined });
		await execHost(["config", "set", "host.id", host.hostId]);
		await execHost(["config", "set", "host.name", host.name]);
		// Default to localhost on correct port for host in standalone mode
		await execHost(["config", "set", "host.controller_url", `http://localhost:${answers.httpPort}/`]);
		await execHost(["config", "set", "host.controller_token", host.token]);
	}

	if (["standalone", "host"].includes(answers.mode)) {
		await execHost(["config", "set", "host.public_address", answers.publicAddress]);
		await execHost(["config", "set", "host.factorio_directory", answers.factorioDir]);
		await setRemoteUpdates(execHost, "host", answers.remoteNpm);
	}

	// Written before pairing as running the installer again on an installed host only pairs it.
	if (!dev && ["standalone", "controller", "host"].includes(answers.mode)) {
		logger.info("Writing run scripts");
		await writeScripts(answers.mode, args.selfSignedCert);
	}

	if (answers.mode === "ctl") {
		await execCtl(["config", "create"]);
		await execCtl(["config", "set", "ctl.controller_url", answers.controllerUrl]);
		await execCtl(["config", "set", "ctl.controller_token", answers.controllerToken]);
	}

	if (answers.mode === "host") {
		if (args.pair) {
			await pairWithController(args, answers);
		} else {
			logger.info("Run the installer again with --mode host in this directory to pair the host");
		}
	}

	/* eslint-disable no-console */
	console.log(`Successfully installed ${answers.mode}`);
	if (adminToken) {
		console.log(`Admin authentication token: ${adminToken}`);
	}
	/* eslint-enable no-console */
}

if (import.meta.main) {
	main().catch(err => {
		process.exitCode = 1;
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
