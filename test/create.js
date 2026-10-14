import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
});
