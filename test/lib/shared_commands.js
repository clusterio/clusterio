import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { slowTest } from "../integration/index.js";


describe("lib/shared_commands", function() {
	describe("isClusterioInstall()", function() {
		const baseDir = path.join("temp", "test", "shared_commands", "is_install");

		beforeEach(async function() {
			await fs.rm(baseDir, { force: true, recursive: true, maxRetries: 10 });
			await fs.mkdir(baseDir, { recursive: true });
		});

		async function writePackageJson(content) {
			await fs.writeFile(path.join(baseDir, "package.json"), JSON.stringify(content));
		}

		it("should be false without a package.json", async function() {
			assert.equal(await lib.isClusterioInstall(baseDir), false);
		});
		it("should be false for an unrelated package.json", async function() {
			await writePackageJson({ name: "something", dependencies: { "left-pad": "^1.0.0" } });
			assert.equal(await lib.isClusterioInstall(baseDir), false);
		});
		it("should be true for the installer package.json", async function() {
			await writePackageJson({ name: "clusterio-install", private: true });
			assert.equal(await lib.isClusterioInstall(baseDir), true);
		});
		it("should be true when a Clusterio package is a dependency", async function() {
			for (const name of ["@clusterio/controller", "@clusterio/host", "@clusterio/ctl"]) {
				await writePackageJson({ dependencies: { [name]: "^2.0.0" } });
				assert.equal(await lib.isClusterioInstall(baseDir), true);
			}
		});
	});

	describe("handlePluginCommand()", function() {
		const oldCwd = process.cwd();
		const baseDir = path.join("temp", "test", "shared_commands", "install");
		const pluginListPath = "plugin-list.json";
		const testPluginPath = path.resolve("test", "file", "test_plugin");
		let pluginList;

		beforeEach(async function() {
			await fs.rm(baseDir, { force: true, recursive: true, maxRetries: 10 });
			await fs.mkdir(baseDir, { recursive: true });
			process.chdir(baseDir);
			pluginList = new Map();
			process.exitCode = undefined;
		});

		afterEach(function() {
			process.chdir(oldCwd);
			process.exitCode = undefined;
		});

		async function run(...argv) {
			await lib.handlePluginCommand({ _: ["plugin", ...argv], package: argv[1], path: argv[1], name: argv[1] },
				pluginList, pluginListPath);
		}

		it("should refuse to install outside a Clusterio installation", async function() {
			await run("install", testPluginPath);
			assert.equal(process.exitCode, 1);
			assert.equal(pluginList.size, 0);
			await assert.rejects(fs.access("node_modules"));
		});

		it("should install and add an npm plugin", async function() {
			slowTest(this);
			await fs.writeFile("package.json", JSON.stringify({ name: "clusterio-install", private: true }));
			await run("install", testPluginPath);
			assert.equal(process.exitCode, undefined);
			assert.deepEqual([...pluginList], [["test_plugin", "test_plugin"]]);
			assert.deepEqual(JSON.parse(await fs.readFile(pluginListPath, "utf8")), [["test_plugin", "test_plugin"]]);
			const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
			assert.ok(packageJson.dependencies.test_plugin);
		});

		it("should report plugins that are already installed", async function() {
			slowTest(this);
			await fs.writeFile("package.json", JSON.stringify({ name: "clusterio-install", private: true }));
			await run("install", testPluginPath);
			assert.deepEqual([...pluginList], [["test_plugin", "test_plugin"]]);
			await run("install", testPluginPath);
			assert.equal(process.exitCode, undefined);
			await run("install", `test_plugin@file:${testPluginPath}`);
			assert.equal(process.exitCode, undefined);
			assert.deepEqual([...pluginList], [["test_plugin", "test_plugin"]]);
		});

		it("should fail when the package is not a plugin", async function() {
			slowTest(this);
			await fs.writeFile("package.json", JSON.stringify({ name: "clusterio-install", private: true }));
			const notAPlugin = path.resolve("not-a-plugin");
			await fs.mkdir(notAPlugin);
			await fs.writeFile(path.join(notAPlugin, "package.json"), JSON.stringify({ name: "not-a-plugin" }));
			await run("install", notAPlugin);
			assert.equal(process.exitCode, 1);
			assert.equal(pluginList.size, 0);
		});

		it("should fail when npm install fails", async function() {
			slowTest(this);
			await fs.writeFile("package.json", JSON.stringify({ name: "clusterio-install", private: true }));
			await run("install", path.resolve("does-not-exist"));
			assert.equal(process.exitCode, 1);
			assert.equal(pluginList.size, 0);
		});

		it("should add, list and remove plugins by path", async function() {
			await run("add", testPluginPath);
			assert.equal(process.exitCode, undefined);
			assert.deepEqual([...pluginList], [["test_plugin", testPluginPath]]);
			await run("add", testPluginPath);
			assert.equal(process.exitCode, 1);
			process.exitCode = undefined;
			await run("remove", "test_plugin");
			assert.equal(process.exitCode, undefined);
			assert.equal(pluginList.size, 0);
			await run("remove", "test_plugin");
			assert.equal(process.exitCode, 1);
		});
	});
});
