import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import events from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
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
		const approved = { hostId: 1234, token: "host-token", name: "Approved" };
		let server;
		let controllerUrl;
		let requests;
		let handler;

		beforeEach(async function() {
			requests = [];
			handler = () => [500, { error: "No handler" }];
			server = http.createServer(async (req, res) => {
				let body = "";
				for await (const chunk of req) {
					body += chunk;
				}
				const entry = { url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
				requests.push(entry);
				const [status, json] = handler(entry);
				res.writeHead(status, { "Content-Type": "application/json" });
				res.end(json === undefined ? undefined : JSON.stringify(json));
			});
			server.listen(0, "localhost");
			await events.once(server, "listening");
			controllerUrl = `http://localhost:${server.address().port}/`;
		});

		afterEach(function() {
			server.closeAllConnections();
			server.close();
		});

		// Stub of the controller pairing endpoints, approving after the given number of pending polls.
		function pairingHandler(pendingPolls = 0, result = approved) {
			let polls = 0;
			return ({ url }) => {
				if (url === "/api/host-pairing") {
					return [202, { requestId: "secret", code: "ABC-DEF" }];
				}
				if (url === "/api/host-pairing/poll") {
					polls += 1;
					return polls > pendingPolls ? [200, result] : [202, { status: "pending" }];
				}
				if (url === "/api/host-pairing/cancel") {
					return [204, undefined];
				}
				return [404, { error: "Not found" }];
			};
		}

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
				if (process.env.CREATE_TEST_SIGINT) {
					// Stands in for Ctrl-C, which cannot be sent to a child process on Windows.
					// Sent twice like when npm init forwards the one it gets to the installer.
					const write = process.stdout.write.bind(process.stdout);
					process.stdout.write = (chunk, ...rest) => {
						if (String(chunk).includes("Waiting for approval")) {
							setTimeout(() => {
								process.emit("SIGINT", "SIGINT");
								process.emit("SIGINT", "SIGINT");
							}, 50);
						}
						return write(chunk, ...rest);
					};
				}
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
			let content;
			try {
				content = await fs.readFile(path.join(directory, "commands.jsonl"), "utf8");
			} catch (err) {
				if (err.code === "ENOENT") {
					return [];
				}
				throw err;
			}
			return content.split("\n").filter(Boolean).map(line => JSON.parse(line))
				.filter(command => !command.startsWith("getent "));
		}

		function hostArgs(...extra) {
			return [
				"--mode", "host", "--host-name", "Test Host", "--controller-url", controllerUrl,
				"--public-address", "host.example.com", "--factorio-dir", "factorio", "--no-remote-npm",
				...extra, "--plugins",
			];
		}

		async function writeHostConfig(token) {
			await fs.writeFile(path.join(directory, "config-host.json"), JSON.stringify({
				"host.name": "Test Host",
				"host.controller_url": controllerUrl,
				"host.controller_token": token,
			}));
		}

		it("pairs a new host once approved and saves its id and token", async function() {
			handler = pairingHandler(0);
			const { stdout } = await run(hostArgs());
			assert(stdout.includes(
				`Waiting for approval. Approve "Test Host" with code ABC-DEF on the Hosts page of ${controllerUrl}, ` +
				"or run: npx clusterioctl host approve ABC-DEF"
			), stdout);
			assert.match(stdout, /Successfully installed host/);

			const { version } = JSON.parse(await fs.readFile(path.join(path.dirname(installer), "package.json")));
			assert.deepEqual(requests[0].body, { name: "Test Host", version });
			assert.equal(requests[0].headers.authorization, undefined);

			const recorded = await commands();
			assert.match(recorded[0], /^npm(?:\.cmd)? install @clusterio\/host$/);
			assert.deepEqual(recorded.slice(1), [
				`${hostBin} config create`,
				hostSet("host.public_address", "host.example.com"),
				hostSet("host.factorio_directory", "factorio"),
				hostSet("host.allow_remote_updates", false),
				hostSet("host.allow_plugin_updates", false),
				hostSet("host.allow_plugin_install", false),
				hostSet("host.name", "Test Host"),
				hostSet("host.controller_url", controllerUrl),
				hostSet("host.id", 1234),
				hostSet("host.name", "Approved"),
				hostSet("host.controller_token", "host-token"),
			]);
			await fs.access(path.join(directory, `run-host${process.platform === "win32" ? ".cmd" : ".sh"}`));
		});

		it("uses --controller-token to approve the host without saving it", async function() {
			handler = ({ headers }) => (headers.authorization === "Bearer user-token"
				? [200, { hostId: 99, token: "host-token", name: "Test Host" }]
				: [401, { error: "Invalid user token" }]
			);
			const { stdout } = await run(hostArgs("--controller-token", "user-token"));
			assert.doesNotMatch(stdout, /Waiting for approval/);
			const recorded = await commands();
			assert(!recorded.some(command => command.includes("user-token")), "user token must not be saved");
			assert.deepEqual(recorded.slice(-2), [
				hostSet("host.id", 99),
				hostSet("host.controller_token", "host-token"),
			]);
		});

		it("cancels the request on Ctrl-C", async function() {
			handler = pairingHandler(Infinity);
			await assert.rejects(run(hostArgs(), { CREATE_TEST_SIGINT: "1" }), err => {
				assert.equal(err.code, 1);
				assert.match(err.stdout + err.stderr, /Pairing cancelled/);
				return true;
			});
			assert.deepEqual(requests.find(r => r.url === "/api/host-pairing/cancel")?.body, { requestId: "secret" });
			assert(!(await commands()).some(command => command.includes("host.controller_token")));
		});

		it("installs without contacting the controller with --no-pair", async function() {
			const { stdout } = await run([
				"--mode", "host", "--no-pair", "--public-address", "localhost", "--factorio-dir", "factorio",
				"--remote-npm", "--plugins",
			]);
			assert.match(stdout, /Successfully installed host/);
			assert.equal(requests.length, 0);
			const recorded = await commands();
			assert(recorded.includes(hostSet("host.allow_plugin_install", true)));
			assert(!recorded.some(command => command.includes("host.controller_token")));
		});

		it("exits when run again on a host the controller accepts", async function() {
			await writeHostConfig("valid-token");
			handler = ({ url, headers }) => {
				const valid = url === "/api/host-pairing/check" && headers.authorization === "Bearer valid-token";
				return valid ? [200, { valid: true }] : [401, undefined];
			};
			const { stdout } = await run(["--mode", "host"]);
			assert.match(stdout, /Host is already set up/);
			assert.deepEqual(requests.map(r => r.url), ["/api/host-pairing/check"]);
			assert.deepEqual(await commands(), []);
		});

		it("pairs again when run again on a revoked host", async function() {
			await writeHostConfig("revoked-token");
			const pairing = pairingHandler(0, { hostId: 5, token: "new-token", name: "Renamed" });
			handler = entry => (entry.url === "/api/host-pairing/check" ? [401, undefined] : pairing(entry));
			const { stdout } = await run([
				"--mode", "host", "--host-name", "Renamed", "--controller-url", controllerUrl,
			]);
			assert.match(stdout, /Successfully set up host/);
			assert.equal(requests[0].headers.authorization, "Bearer revoked-token");
			assert.equal(requests[1].body.name, "Renamed");
			assert.deepEqual(await commands(), [
				hostSet("host.name", "Renamed"),
				hostSet("host.controller_url", controllerUrl),
				hostSet("host.id", 5),
				hostSet("host.controller_token", "new-token"),
			]);
		});

		it("does not send the saved token to another controller", async function() {
			await writeHostConfig("old-token");
			// Same stub server under its IP address, which the installer sees as another controller.
			const { address, port } = server.address();
			const otherUrl = `http://${address.includes(":") ? `[${address}]` : address}:${port}/`;
			handler = pairingHandler(0, { hostId: 6, token: "other-token", name: "Moved" });
			const { stdout } = await run(["--mode", "host", "--host-name", "Moved", "--controller-url", otherUrl]);
			assert.match(stdout, /Successfully set up host/);
			assert(!requests.some(r => r.url === "/api/host-pairing/check"), "token checked with other controller");
			assert(!requests.some(r => String(r.headers.authorization).includes("old-token")));
			assert.deepEqual(await commands(), [
				hostSet("host.name", "Moved"),
				hostSet("host.controller_url", otherUrl),
				hostSet("host.id", 6),
				hostSet("host.controller_token", "other-token"),
			]);
		});

		it("adds the trailing slash the host requires to the controller URL", async function() {
			handler = pairingHandler(0);
			const args = hostArgs();
			args[args.indexOf(controllerUrl)] = controllerUrl.slice(0, -1);
			await run(args);
			assert((await commands()).includes(hostSet("host.controller_url", controllerUrl)));
		});

		it("writes the certificate into the run scripts when run again with one", async function() {
			await writeHostConfig("valid-token");
			handler = ({ url }) => (url === "/api/host-pairing/check" ? [200, { valid: true }] : [404, undefined]);
			const cert = path.resolve(import.meta.dirname, "file", "tls", "cert.pem");
			const { stdout } = await run(["--mode", "host", "--self-signed-cert", cert]);
			assert.match(stdout, /Host is already set up/);
			const script = process.platform === "win32" ? "run-host.cmd" : "run-host.sh";
			const content = await fs.readFile(path.join(directory, script), "utf8");
			assert(content.includes(`NODE_EXTRA_CA_CERTS=${cert}`), content);
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
			assert(!recorded.some(command => command.includes("generate-host-token")));
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
