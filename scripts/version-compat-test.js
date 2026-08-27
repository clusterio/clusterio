#!/usr/bin/env node
/**
 * Version compatibility smoke test
 *
 * Starts a controller and a host where one side runs from this repository
 * and the other from a release published to npm, then verifies the host
 * connects to the controller and can be assigned an instance.
 *
 * Usage:
 *   node scripts/version-compat-test.js --controller local --host published
 *   node scripts/version-compat-test.js --controller published --host local --published-version 2.0.0-alpha.27
 *
 * The repository must be built (pnpm run build) before running with a local side.
 */
"use strict";
const child_process = require("child_process");
const events = require("events");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");
const util = require("util");

const execFile = util.promisify(child_process.execFile);

const repoRoot = path.join(__dirname, "..");
const workDir = path.join(repoRoot, "temp", "compat-test");
const controllerDir = path.join(workDir, "controller");
const hostDir = path.join(workDir, "host");
const publishedDir = path.join(workDir, "published");
const httpPort = 8899;

const daemons = [];

function parseArgs() {
	const options = { controller: undefined, host: undefined, publishedVersion: "latest" };
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--controller") { options.controller = argv[++i]; continue; }
		if (argv[i] === "--host") { options.host = argv[++i]; continue; }
		if (argv[i] === "--published-version") { options.publishedVersion = argv[++i]; continue; }
		console.error(`Unknown argument ${argv[i]}`);
		process.exit(1);
	}
	for (const side of ["controller", "host"]) {
		if (!["local", "published"].includes(options[side])) {
			console.error(`--${side} must be either local or published`);
			process.exit(1);
		}
	}
	return options;
}

function packageDir(pkg, source) {
	if (source === "local") {
		return path.join(repoRoot, "packages", pkg);
	}
	return path.join(publishedDir, "node_modules", "@clusterio", pkg);
}

async function packageVersion(pkg, source) {
	const json = JSON.parse(await fs.readFile(path.join(packageDir(pkg, source), "package.json"), "utf8"));
	return `${json.version} (${source})`;
}

async function run(name, pkgDir, cliArgs, cwd) {
	console.log(`| ${name} ${cliArgs.join(" ")}`);
	try {
		const result = await execFile(process.execPath, [pkgDir, ...cliArgs], { cwd });
		for (const line of `${result.stdout}${result.stderr}`.split("\n")) {
			if (line.trim()) { console.log(`${name}: ${line}`); }
		}
		return result;
	} catch (err) {
		console.error(`${name}: command failed\n${err.stdout ?? ""}${err.stderr ?? ""}`);
		throw err;
	}
}

function spawnDaemon(name, pkgDir, cliArgs, cwd, readyRegex, timeoutMs = 120e3) {
	console.log(`| ${name} ${cliArgs.join(" ")}`);
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn(process.execPath, [pkgDir, ...cliArgs], { cwd });
		daemons.push(proc);
		let ready = false;
		const timeout = setTimeout(() => {
			reject(new Error(`Timed out waiting for ${name} to log ${readyRegex}`));
		}, timeoutMs);
		function watch(stream) {
			readline.createInterface({ input: stream }).on("line", line => {
				console.log(`${name}: ${line}`);
				if (!ready && readyRegex.test(line)) {
					ready = true;
					clearTimeout(timeout);
					resolve(proc);
				}
			});
		}
		watch(proc.stdout);
		watch(proc.stderr);
		proc.on("exit", (code, signal) => {
			if (!ready) {
				clearTimeout(timeout);
				reject(new Error(`${name} exited with ${signal ?? code} before logging ${readyRegex}`));
			}
		});
	});
}

async function shutdown(name, proc) {
	if (!proc || proc.exitCode !== null) {
		return;
	}
	console.log(`| stopping ${name}`);
	proc.kill("SIGINT");
	const [code, signal] = await events.once(proc, "exit");
	console.log(`${name}: exited with ${signal ?? code}`);
}

async function pollCtl(ctl, cliArgs, expectRegex, description, timeoutMs = 30e3) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const result = await run("ctl", ctl, cliArgs, controllerDir);
		if (expectRegex.test(result.stdout)) {
			return;
		}
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${description}`);
		}
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}

async function main() {
	const options = parseArgs();

	await fs.rm(workDir, { force: true, recursive: true, maxRetries: 10 });
	await fs.mkdir(controllerDir, { recursive: true });
	await fs.mkdir(hostDir, { recursive: true });
	await fs.mkdir(path.join(hostDir, "factorio"), { recursive: true });

	const published = [];
	if (options.controller === "published") { published.push("controller", "ctl"); }
	if (options.host === "published") { published.push("host"); }
	if (published.length) {
		await fs.mkdir(publishedDir, { recursive: true });
		await fs.writeFile(path.join(publishedDir, "package.json"), JSON.stringify({ private: true }));
		const specs = published.map(pkg => `@clusterio/${pkg}@${options.publishedVersion}`);
		console.log(`| npm install ${specs.join(" ")}`);
		await execFile("npm", ["install", "--no-audit", "--no-fund", ...specs], { cwd: publishedDir });
	}

	const controller = packageDir("controller", options.controller);
	const host = packageDir("host", options.host);
	// Use the ctl matching the controller version as it connects to the controller.
	const ctl = packageDir("ctl", options.controller);

	console.log(`Testing controller ${await packageVersion("controller", options.controller)} `
		+ `with host ${await packageVersion("host", options.host)}`);

	await run("controller", controller, ["config", "set", "controller.http_port", String(httpPort)], controllerDir);
	await run("controller", controller, ["bootstrap", "create-admin", "test"], controllerDir);
	await run("controller", controller, ["bootstrap", "create-ctl-config", "test"], controllerDir);
	const controllerProc = await spawnDaemon(
		"controller", controller, ["run"], controllerDir, /Started controller/
	);

	try {
		await run("ctl", ctl, [
			"host", "create-config", "--id", "1", "--name", "host", "--generate-token",
			"--output", path.join(hostDir, "config-host.json"),
		], controllerDir);

		// Started host is only logged after the connection to the controller is established.
		const hostProc = await spawnDaemon("host", host, ["run"], hostDir, /Started host/);
		await pollCtl(ctl, ["host", "list"], /\bhost\b.*\btrue\b/, "host to show as connected");

		await run("ctl", ctl, ["instance", "create", "compat", "--id", "10"], controllerDir);
		await run("ctl", ctl, ["instance", "assign", "compat", "host"], controllerDir);
		await pollCtl(ctl, ["instance", "list"], /\bcompat\b.*\bstopped\b/, "instance to show as stopped");

		await shutdown("host", hostProc);
	} finally {
		await shutdown("controller", controllerProc);
	}

	console.log(`PASS: ${options.controller} controller accepted connection from ${options.host} host`);
}

const watchdog = setTimeout(() => {
	console.error("FAIL: test timed out");
	process.exit(1);
}, 600e3);

main().then(() => {
	clearTimeout(watchdog);
	for (const proc of daemons) { proc.kill(); }
}).catch(err => {
	console.error(`FAIL: ${err.message}`);
	for (const proc of daemons) { proc.kill(); }
	process.exit(1);
});
