#!/usr/bin/env node

"use strict";
const child_process = require("child_process");
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
const finished = util.promisify(stream.finished);


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
	let { dir, name, ext } = path.parse(file);
	let temporary = path.join(dir, `${name}.tmp${ext}`);
	await fs.outputFile(temporary, data, options);
	await fs.rename(temporary, file);
}

async function execFile(cmd, args) {
	logger.verbose(`executing ${cmd} ${args.join(" ")}`);
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

async function execController(args) {
	if (dev) {
		return await execFile("node", [path.join(__dirname, "..", "controller"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusteriocontroller${scriptExt}`), args);
}

async function execHost(args) {
	if (dev) {
		return await execFile("node", [path.join(__dirname, "..", "host"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusteriohost${scriptExt}`), args);
}

async function execCtl(args) {
	if (dev) {
		return await execFile("node", [path.join(__dirname, "..", "ctl"), ...args]);
	}
	return await execFile(path.join("node_modules", ".bin", `clusterioctl${scriptExt}`), args);
}

function validateHostToken(token) {
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

	if (parsed.aud !== "host" || !Number.isInteger(parsed.host)) {
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
		if (await fs.pathExists(source) && !await fs.pathExists(destination)) {
			await safeOutputFile(destination, JSON.stringify(
				renameConfig(JSON.parse(await fs.readFile(source))), null, "\t"
			));
			logger.info(`Migrated ${source} to ${destination}`);
		}
	}

	await migrateConfig("config-master.json", "config-controller.json");
	await migrateConfig("config-slave.json", "config-host.json");

	let instancesFile = path.join("database", "instances.json");
	if (await fs.pathExists(instancesFile)) {
		await safeOutputFile(instancesFile, JSON.stringify(
			JSON.parse(await fs.readFile(instancesFile)).map(renameConfig), null, "\t"
		));
		logger.info(`Migrated ${instancesFile}`);
	}

	let usersFile = path.join("database", "users.json");
	if (await fs.pathExists(usersFile)) {
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
		let fileStream = fs.createReadStream(inputFile);
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
		if (await fs.pathExists(inputLogs)) {
			logger.info(`Migrating ${inputLogs} to ${outputLogs}`);
			for (let logFile of await fs.readdir(inputLogs)) {
				if (!logFile.endsWith(".log")) {
					continue;
				}
				let inputFile = path.join(inputLogs, logFile);
				let outputFile = path.join(outputLogs, rename(logFile));
				if (!await fs.pathExists(outputFile)) {
					await migrateLog(inputFile, outputFile);
					logger.verbose(`Migrated ${inputFile} to ${outputFile}`);
				}
			}
		}
	}

	await migrateLogsDir(path.join("logs", "master"), path.join("logs", "controller"));
	await migrateLogsDir(path.join("logs", "slave"), path.join("logs", "host"));
	if (
		await fs.pathExists(path.join("logs", "cluster"))
		&& !await fs.pathExists(path.join("logs", "cluster-prerename"))
	) {
		await fs.rename(path.join("logs", "cluster"), path.join("logs", "cluster-prerename"));
		await migrateLogsDir(path.join("logs", "cluster-prerename"), path.join("logs", "cluster"));
	}

	if (
		await fs.pathExists("sharedMods")
		&& !await fs.pathExists("mods")
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

	const hasRunMaster = await fs.pathExists("run-master.sh") || await fs.pathExists("run-master.cmd");
	const hasRunSlave = await fs.pathExists("run-slave.sh") || await fs.pathExists("run-slave.cmd");
	if (hasRunMaster || hasRunSlave) {
		logger.info("Writing run scripts");
		let mode = "standalone";
		if (!hasRunSlave) { mode = "controller"; }
		if (!hasRunMaster) { mode = "host"; }
		await writeScripts(mode);
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
		await fs.outputFile("package.json", JSON.stringify({
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
				let pluginInfo = require(require.resolve(plugin, { paths: [process.cwd()] })).plugin;
				pluginList.set(pluginInfo.name, plugin);
			}
		}
		try {
			await safeOutputFile("plugin-list.json", JSON.stringify([...pluginList], null, "\t"));
		} catch (err) {
			throw new InstallError(`Error writing plugin-list.json: ${err.message}`);
		}
	}
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

async function writeScripts(mode) {
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
			await safeOutputFile(
				"run-host.cmd",
				`\
@echo off
set "NODE_OPTIONS=--enable-source-maps %NODE_OPTIONS%"
:restart
call .\\node_modules\\.bin\\clusteriohost.cmd run --can-restart
if %errorlevel% equ 0 exit /b
if %errorlevel% equ 8 exit /b
goto restart
`
			);
		} else {
			await safeOutputFile(
				"run-host.sh",
				`\
#!/bin/bash
export "NODE_OPTIONS=--enable-source-maps $NODE_OPTIONS"
while true; do
	./node_modules/.bin/clusteriohost run --can-restart
	if [[ $? -eq 0 || $? -eq 8 ]]; then exit $?; fi
done
`,
				{ mode: 0o755 },
			);
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
ExecStart=${process.cwd()}/node_modules/.bin/clusteriohost run --log-level=warn --can-restart
Restart=on-failure
RestartPreventExitStatus=8

[Install]
WantedBy=multi-user.target
`
			);
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
				{ name: "Standalone (install both controller and host on this computer)", value: "standalone" },
				{ name: "Controller only", value: "controller" },
				{ name: "Host only", value: "host" },
				{ name: "Ctl only", value: "ctl" },
				{ name: "Plugins only", value: "plugins" },
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
	}

	if (answers.mode === "host") {
		if (args.hostName) { answers.hostName = args.hostName; }
		answers = await inquirer.prompt([
			{
				type: "input",
				name: "hostName",
				message: "Name of host",
			},
		], answers);
	}

	if (["host", "ctl"].includes(answers.mode)) {
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

	if (answers.mode === "host") {
		validateHostToken(answers.controllerToken);
	}

	if (["standalone", "host"].includes(answers.mode)) {
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

		await finished(writeStream);

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
			choices: ["standalone", "controller", "host", "ctl", "plugins"],
		})
		.option("migrate-rename", {
			nargs: 0, describe: "Migrate from before slave/master rename", default: false, type: "boolean",
		})
		.option("admin", {
			nargs: 1, describe: "Admin account name [standalone/controller]", type: "string",
		})
		.option("host-name", {
			nargs: 1, describe: "Host name [host]", type: "string",
		})
		.option("controller-url", {
			nargs: 1, describe: "Controller URL [host/ctl]", type: "string",
		})
		.option("controller-token", {
			nargs: 1, describe: "Controller authentication token [host/ctl]", type: "string",
		})
		.option("public-address", {
			nargs: 1, describe: "DNS/IP Address to connect to this server [standalone/host]", type: "string",
		})
		.option("factorio-dir", {
			nargs: 1, describe: "Path to Factorio installation [standalone/host]", type: "string",
		})
		.option("plugins", {
			array: true, describe: "Plugins to install", type: "string",
		})
		.strict()
	;

	if (process.platform === "linux") {
		args = args
			.option("allow-install-as-root", {
				nargs: 0, describe: "(Linux only) Allow installing as root (not recommended)", type: "boolean",
			})
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
		await validateNotRoot(args);
	}

	if (args.migrateRename) {
		await migrateRename(args);
		return;
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
	if (["standalone", "controller"].includes(answers.mode)) {
		logger.info("Setting up controller");
		await execController(["bootstrap", "create-admin", answers.admin]);
		let result = await execController(["bootstrap", "generate-user-token", answers.admin]);
		adminToken = result.stdout.split("\n").slice(-2)[0];
	}

	if (answers.mode === "standalone") {
		logger.info("Setting up host");
		await execHost(["config", "set", "host.name", "local"]);

		let result = await execHost(["config", "show", "host.id"]);
		let hostId = Number.parseInt(result.stdout.split("\n").slice(-2)[0], 10);

		result = await execController(["bootstrap", "generate-host-token", hostId]);
		let hostToken = result.stdout.split("\n").slice(-2)[0];

		await execHost(["config", "set", "host.controller_token", hostToken]);
		await execHost(["config", "set", "host.public_address", answers.publicAddress]);
		await execHost(["config", "set", "host.factorio_directory", answers.factorioDir]);
	}

	if (answers.mode === "host") {
		logger.info("Setting up host");
		let hostId = JSON.parse(Buffer.from(answers.controllerToken.split(".")[1], "base64")).host;
		await execHost(["config", "set", "host.id", hostId]);
		await execHost(["config", "set", "host.name", answers.hostName]);
		await execHost(["config", "set", "host.controller_url", answers.controllerUrl]);
		await execHost(["config", "set", "host.controller_token", answers.controllerToken]);
		await execHost(["config", "set", "host.public_address", answers.publicAddress]);
		await execHost(["config", "set", "host.factorio_directory", answers.factorioDir]);
	}

	if (!dev && ["standalone", "controller", "host"].includes(answers.mode)) {
		logger.info("Writing run scripts");
		await writeScripts(answers.mode);
	}

	if (answers.mode === "ctl") {
		await execCtl(["control-config", "set", "control.controller_url", answers.controllerUrl]);
		await execCtl(["control-config", "set", "control.controller_token", answers.controllerToken]);
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
