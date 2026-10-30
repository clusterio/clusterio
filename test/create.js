import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";

import { escapeArg } from "../packages/create/escape_arg.js";

const execFileAsync = promisify(execFile);
const installer = path.resolve(import.meta.dirname, "../packages/create/create.js");
const discoveryUrl = new URL("../packages/lib/dist/node/src/load_plugin_list.js", import.meta.url).href;

describe("create installer CLI", function() {
	this.timeout(10000);
	let directory;

	beforeEach(async function() {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio install #"));
		await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({
			name: "clusterio-install", private: true,
		}));
	});

	afterEach(async function() {
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 10 });
	});

	async function addPlugin(name, type, source) {
		const pluginDir = path.join(directory, "node_modules", name);
		await fs.mkdir(pluginDir, { recursive: true });
		await fs.writeFile(path.join(pluginDir, "package.json"), JSON.stringify({
			name, version: "1.0.0", type, main: "index.js", keywords: ["clusterio-plugin"],
		}));
		await fs.writeFile(path.join(pluginDir, "index.js"), source);
		const packagePath = path.join(directory, "package.json");
		const pkg = JSON.parse(await fs.readFile(packagePath));
		pkg.dependencies = { ...pkg.dependencies, [name]: "1.0.0" };
		await fs.writeFile(packagePath, JSON.stringify(pkg));
	}

	function runInstaller(plugins, installFails = false) {
		// Only replace npm's subprocess: fixtures stand in for downloaded packages.
		// Run the actual CLI from outside the installation, like npm init does.
		const mockNpm = `
			import assert from "node:assert/strict";
			import childProcess from "node:child_process";
			import { PassThrough } from "node:stream";
			childProcess.execFile = (command, options, callback) => {
				assert.match(command, /^npm(?:\\.cmd)? install /);
				const stdout = new PassThrough();
				const stderr = new PassThrough();
				queueMicrotask(() => {
					stdout.end();
					stderr.end();
					callback(${installFails} ? new Error("npm install failed") : null, "", "");
				});
				return { stdout, stderr };
			};
		`;
		return execFileAsync(process.execPath, [
			"--import", `data:text/javascript,${encodeURIComponent(mockNpm)}`,
			installer, "--mode", "plugins",
			...(process.platform === "linux" ? ["--allow-install-as-root"] : []),
			"--plugins", ...plugins,
		], { cwd: directory });
	}

	it("installs plugins without importing them or writing a plugin list", async function() {
		await addPlugin("@installer-test/deferred", "module", 'throw new Error("installer must not import plugins");');
		const { stdout } = await runInstaller(["@installer-test/deferred"]);
		assert.match(stdout, /Successfully installed plugins/);
		await assert.rejects(fs.access(path.join(directory, "plugin-list.json")), { code: "ENOENT" });
	});

	[false, true].forEach(existingList => {
		it(`defers registration to discovery ${existingList ? "preserving existing entries" : "with no list"}`,
			async function() {
				await addPlugin("@installer-test/esm", "module", 'export const plugin = { name: "esm_plugin" };');
				await addPlugin("@installer-test/commonjs", "commonjs", 'exports.plugin = { name: "cjs_plugin" };');
				const listPath = path.join(directory, "plugin-list.json");
				const previousEntries = existingList ? [["manual", "./plugins/manual"]] : [];
				const previousContents = JSON.stringify(previousEntries);
				if (existingList) {
					await fs.writeFile(listPath, previousContents);
				}
				const { stdout } = await runInstaller(["@installer-test/esm", "@installer-test/commonjs"]);
				assert.match(stdout, /Successfully installed plugins/);
				if (existingList) {
					assert.equal(await fs.readFile(listPath, "utf8"), previousContents);
				} else {
					await assert.rejects(fs.access(listPath), { code: "ENOENT" });
				}

				// Use the real discovery function invoked by controller/host/ctl commands.
				await execFileAsync(process.execPath, [
					"--input-type=module", "--eval",
					`import { loadPluginList } from ${JSON.stringify(discoveryUrl)};
					await loadPluginList("plugin-list.json");`,
				], { cwd: directory });
				assert.deepEqual(JSON.parse(await fs.readFile(listPath)), [
					...previousEntries,
					["esm_plugin", "@installer-test/esm"],
					["cjs_plugin", "@installer-test/commonjs"],
				]);
			}
		);
	});

	it("exits with failure when npm installation fails", async function() {
		await assert.rejects(runInstaller(["@installer-test/missing"], true), err => {
			assert.equal(err.code, 1);
			assert.match(err.stdout + err.stderr, /Failed to install: npm install failed/);
			assert.doesNotMatch(err.stdout, /Successfully installed/);
			return true;
		});
	});

	it("exits with failure on an unexpected installer error", async function() {
		await fs.writeFile(path.join(directory, "package.json"), "null");
		await assert.rejects(runInstaller([]), err => {
			assert.equal(err.code, 1);
			assert.match(err.stdout + err.stderr, /TypeError/);
			assert.doesNotMatch(err.stdout, /Successfully installed/);
			return true;
		});
	});

	describe("host setup", function() {
		const scriptExt = process.platform === "win32" ? ".cmd" : "";
		const hostBin = path.join("node_modules", ".bin", `clusteriohost${scriptExt}`);
		const controllerBin = path.join("node_modules", ".bin", `clusteriocontroller${scriptExt}`);
		const hostSet = (field, value) => `${hostBin} config set ${field} ${escapeArg(String(value))}`;
		const controllerUrl = "http://controller.example.com:8080/";

		function run(args, env = {}) {
			// Record the commands for npm and the clusterio CLIs instead of running them.
			const mockExec = `
				import childProcess from "node:child_process";
				import fs from "node:fs";
				import { PassThrough } from "node:stream";
				childProcess.execFile = (command, options, callback) => {
					fs.appendFileSync(process.env.CREATE_TEST_COMMANDS, JSON.stringify(command) + "\\n");
					const stdout = new PassThrough();
					const stderr = new PassThrough();
					// Lets tests give the host id a config show prints.
					const output = process.env.CREATE_TEST_HOST_ID && command.includes("config show host.id")
						? process.env.CREATE_TEST_HOST_ID + "\\n" : "";
					queueMicrotask(() => {
						stdout.end();
						stderr.end();
						callback(null, output, "");
					});
					return { stdout, stderr };
				};
			`;
			return execFileAsync(process.execPath, [
				"--import", `data:text/javascript,${encodeURIComponent(mockExec)}`,
				installer,
				...(process.platform === "linux" ? ["--allow-install-as-root"] : []),
				...args,
			], {
				cwd: directory,
				env: { ...process.env, CREATE_TEST_COMMANDS: path.join(directory, "commands.jsonl"), ...env },
			});
		}

		// Commands run by the installer, without the getent lookups made when writing systemd units.
		async function commands() {
			const content = await fs.readFile(path.join(directory, "commands.jsonl"), "utf8");
			return content.split("\n").filter(Boolean).map(line => JSON.parse(line))
				.filter(command => !command.startsWith("getent "));
		}

		function hostArgs(url = controllerUrl) {
			return [
				"--mode", "host", "--host-name", "Test Host", "--controller-url", url,
				"--public-address", "host.example.com", "--factorio-dir", "factorio", "--no-remote-npm", "--plugins",
			];
		}

		it("writes the host config and leaves joining the cluster to the host", async function() {
			const { stdout } = await run(hostArgs());
			assert.match(stdout, /Successfully installed host/);
			assert.match(stdout, /Start the host with run-host/);

			const recorded = await commands();
			assert.match(recorded[0], /^npm(?:\.cmd)? install @clusterio\/host$/);
			assert.deepEqual(recorded.slice(1), [
				`${hostBin} config create`,
				hostSet("host.name", "Test Host"),
				hostSet("host.controller_url", controllerUrl),
				hostSet("host.public_address", "host.example.com"),
				hostSet("host.factorio_directory", "factorio"),
				hostSet("host.allow_remote_updates", false),
				hostSet("host.allow_plugin_updates", false),
				hostSet("host.allow_plugin_install", false),
			]);
			await fs.access(path.join(directory, `run-host${process.platform === "win32" ? ".cmd" : ".sh"}`));
		});

		it("adds the trailing slash the host requires to the controller URL", async function() {
			await run(hostArgs(controllerUrl.slice(0, -1)));
			assert((await commands()).includes(hostSet("host.controller_url", controllerUrl)));
		});

		it("adds the host of a standalone install to the controller database", async function() {
			const secret = crypto.randomBytes(256).toString("base64");
			await fs.writeFile(path.join(directory, "config-controller.json"), JSON.stringify({
				"controller.auth_secret": secret,
			}));
			const { stdout } = await run([
				"--mode", "standalone", "--admin", "admin", "--http-port", "8123", "--public-address", "localhost",
				"--factorio-dir", "factorio", "--remote-npm", "--plugins",
			]);
			assert.match(stdout, /Successfully installed standalone/);

			const hosts = JSON.parse(await fs.readFile(path.join(directory, "database", "hosts.json")));
			assert.equal(hosts.length, 1);
			assert.equal(hosts[0].name, "local");

			const recorded = await commands();
			const tokenSet = `${hostBin} config set host.controller_token `;
			const token = recorded.find(command => command.startsWith(tokenSet)).slice(tokenSet.length);
			const payload = jwt.verify(token, Buffer.from(secret, "base64"), { audience: "host" });
			assert.equal(payload.host, hosts[0].id);
			for (const expected of [
				hostSet("host.id", hosts[0].id),
				hostSet("host.name", "local"),
				hostSet("host.controller_url", "http://localhost:8123/"),
				`${controllerBin} config set controller.allow_remote_updates true`,
				`${controllerBin} config set controller.allow_plugin_updates true`,
				`${controllerBin} config set controller.allow_plugin_install true`,
				hostSet("host.allow_remote_updates", true),
				hostSet("host.allow_plugin_updates", true),
				hostSet("host.allow_plugin_install", true),
			]) {
				assert(recorded.includes(expected), `missing ${expected}`);
			}
		});

		it("keeps the host of a standalone install when run again", async function() {
			const secret = crypto.randomBytes(256).toString("base64");
			await fs.writeFile(path.join(directory, "config-controller.json"), JSON.stringify({
				"controller.auth_secret": secret,
			}));
			await fs.mkdir(path.join(directory, "database"));
			const existing = [{ id: 1234, name: "local", version: "2.0.3", plugins: {}, token_valid_after: 1 }];
			await fs.writeFile(path.join(directory, "database", "hosts.json"), JSON.stringify(existing));
			const { stdout } = await run([
				"--mode", "standalone", "--admin", "admin", "--http-port", "8123", "--public-address", "localhost",
				"--factorio-dir", "factorio", "--remote-npm", "--plugins",
			], { CREATE_TEST_HOST_ID: "1234" });
			assert.match(stdout, /Successfully installed standalone/);

			assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "database", "hosts.json"))), existing);
			const recorded = await commands();
			assert(recorded.includes(hostSet("host.id", 1234)), "host id was changed");
			const tokenSet = `${hostBin} config set host.controller_token `;
			const token = recorded.find(command => command.startsWith(tokenSet)).slice(tokenSet.length);
			assert.equal(jwt.verify(token, Buffer.from(secret, "base64"), { audience: "host" }).host, 1234);
		});
	});
});
