import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const installer = path.resolve(import.meta.dirname, "../packages/create/create.js");

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
			name, version: "1.0.0", type, main: "index.js",
		}));
		await fs.writeFile(path.join(pluginDir, "index.js"), source);
	}

	function runInstaller(plugins, installFails = false) {
		// Only replace npm's subprocess: fixtures stand in for downloaded packages.
		// Run the actual CLI from outside the installation and keep module loading real.
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

	it("registers ESM and CommonJS plugins installed beside the user's package.json", async function() {
		await addPlugin("@installer-test/esm", "module", 'export const plugin = { name: "esm_plugin" };');
		await addPlugin("@installer-test/commonjs", "commonjs", 'exports.plugin = { name: "cjs_plugin" };');
		const { stdout } = await runInstaller(["@installer-test/esm", "@installer-test/commonjs"]);
		assert.match(stdout, /Successfully installed plugins/);
		assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "plugin-list.json"))), [
			["esm_plugin", "@installer-test/esm"],
			["cjs_plugin", "@installer-test/commonjs"],
		]);
	});

	it("exits with failure when npm installation fails", async function() {
		await assert.rejects(runInstaller(["@installer-test/missing"], true), err => {
			assert.equal(err.code, 1);
			assert.match(err.stdout + err.stderr, /Failed to install: npm install failed/);
			assert.doesNotMatch(err.stdout, /Successfully installed/);
			return true;
		});
	});

	it("exits with failure when a plugin throws while loading", async function() {
		await addPlugin("@installer-test/broken", "module", 'throw new Error("plugin initialization failed");');
		await assert.rejects(runInstaller(["@installer-test/broken"]), err => {
			assert.equal(err.code, 1);
			assert.match(err.stdout + err.stderr, /plugin initialization failed/);
			assert.doesNotMatch(err.stdout, /Successfully installed/);
			return true;
		});
	});
});
