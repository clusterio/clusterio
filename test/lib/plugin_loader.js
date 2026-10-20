import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as mock from "../mock.js";
import * as lib from "@clusterio/lib";
import { BaseControllerPlugin } from "@clusterio/controller";
import { computePluginStatuses, planUpdate } from "../../packages/web_ui/src/util/plugin_status.ts";


describe("lib/plugin_loader", function() {
	describe("loadPluginInfos()", function() {
		let baseDir = path.join("temp", "test", "plugin");
		let missingPlugin = path.join(baseDir, "missing_plugin");
		let testPlugin = path.join(baseDir, "test_plugin");
		let brokenPlugin = path.join(baseDir, "broken_plugin");
		let invalidPlugin = path.join(baseDir, "invalid_plugin");
		before(async function() {
			async function writePlugin(pluginPath, infoName) {
				await fs.mkdir(pluginPath, { recursive: true });
				await fs.writeFile(
					path.join(pluginPath, "index.js"),
					`export const plugin = { name: "${infoName}" };`
				);
				await fs.writeFile(
					path.join(pluginPath, "package.json"),
					'{ "version": "0.0.1" }'
				);
			}

			await writePlugin(testPlugin, "test");
			await writePlugin(brokenPlugin, "broken");
			await fs.writeFile(path.join(brokenPlugin, "index.js"), "Syntax Error");
			await writePlugin(invalidPlugin, "wrong");
		});

		it("should ignore missing plugins", async function() {
			const result = await lib.loadPluginInfos(new Map([
				["missing", path.resolve(missingPlugin)],
				["no_index", path.resolve(baseDir)],
			]), []);
			assert.deepEqual(result, []);
		});
		it("should load test plugin", async function() {
			assert.deepEqual(
				await lib.loadPluginInfos(new Map([["test", path.resolve(testPlugin)]])),
				[{
					name: "test",
					version: "0.0.1",
					npmPackage: undefined,
					packagePath: path.resolve(path.join(testPlugin, "package.json")),
					requirePath: path.resolve(testPlugin),
					webStaticPath: path.resolve(path.join(testPlugin, "dist", "web", "static")),
				}]
			);
		});
		it("should reject on broken plugin", async function() {
			let brokenMessage;
			try {
				await import(pathToFileURL(path.resolve(path.join(brokenPlugin, "index.js"))));
			} catch (err) {
				brokenMessage = err.message;
			}
			await assert.rejects(
				lib.loadPluginInfos(new Map([["broken", path.resolve(brokenPlugin)]])),
				{ message: `PluginError: ${brokenMessage}` }
			);
		});
		describe("plugin installed from npm", function() {
			// Plugins from npm are listed by package name, so they must be resolved like a dependency
			const packageDir = path.resolve("node_modules", "@clusterio-test", "npm_plugin");
			before(async function() {
				await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
				await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({
					name: "@clusterio-test/npm_plugin", version: "0.0.2", main: "dist/index.js", type: "module",
				}));
				await fs.writeFile(
					path.join(packageDir, "dist", "index.js"),
					'export const plugin = { name: "npm_plugin", controllerEntrypoint: "dist/controller.js" };',
				);
				await fs.writeFile(
					path.join(packageDir, "dist", "controller.js"),
					"export default async function(context) { context.controller.loadedNpmPlugin = true; }",
				);
			});
			after(async function() {
				await fs.rm(path.dirname(packageDir), { recursive: true, force: true });
			});

			it("should load the plugin and its entrypoints", async function() {
				const [pluginInfo] = await lib.loadPluginInfos(
					new Map([["npm_plugin", "@clusterio-test/npm_plugin"]])
				);
				assert.equal(pluginInfo.name, "npm_plugin");
				assert.equal(pluginInfo.npmPackage, "@clusterio-test/npm_plugin");
				assert.equal(pluginInfo.packagePath, path.join(packageDir, "package.json"));

				const controller = new mock.MockController();
				await lib.loadPlugin(
					pluginInfo, "controller", { controller, metrics: {}, logger: new mock.MockLogger() },
					"ControllerPlugin", BaseControllerPlugin,
				);
				assert.equal(controller.loadedNpmPlugin, true);
			});
		});
		it("should reject on invalid plugin", async function() {
			await assert.rejects(
				lib.loadPluginInfos(new Map([["invalid", path.resolve(invalidPlugin)]])),
				{ message: `Expected plugin at ${path.resolve(invalidPlugin)} to be named invalid but got wrong` }
			);
		});
	});
	describe("loadPluginMigrations()", function() {
		const baseDir = path.resolve("temp", "test", "plugin", "migration_plugin");
		before(async function() {
			await fs.mkdir(baseDir, { recursive: true });
			await fs.writeFile(path.join(baseDir, "migrations.js"), `
				export default function(context) {
					context.hooks.controllerConfig.attach(context.plugin.name, config => {
						config.migratedBy = context.plugin.name;
						return config;
					});
				}
			`);
			await fs.writeFile(path.join(baseDir, "throwing.js"), `
				export default function() { throw new Error("load failed"); }
			`);
		});
		afterEach(function() {
			lib.ControllerConfig.pluginMigrations.clear();
			lib.Config.pluginVersions.clear();
		});

		function info(entrypoint) {
			return {
				name: "test",
				version: "1.0.0",
				packagePath: path.join(baseDir, "package.json"),
				migrationEntrypoint: entrypoint,
			};
		}

		it("should attach migrations from the migration entrypoint", async function() {
			await lib.loadPluginMigrations([info("migrations.js"), { name: "other" }]);
			assert.deepEqual([...lib.ControllerConfig.pluginMigrations.attached], ["test"]);
			assert.deepEqual(lib.ControllerConfig.pluginMigrations.reduce({}), { migratedBy: "test" });
		});
		it("should register the version of every plugin", async function() {
			await lib.loadPluginMigrations([info("migrations.js"), { name: "other", version: "2.0.0" }]);
			assert.deepEqual([...lib.Config.pluginVersions], [["test", "1.0.0"], ["other", "2.0.0"]]);
		});
		it("should reject with a PluginError if the entrypoint throws", async function() {
			await assert.rejects(
				lib.loadPluginMigrations([info("throwing.js")]),
				err => err instanceof lib.PluginError && err.pluginName === "test"
			);
		});
	});
	describe("loadPlugin()", function() {
		const baseDir = path.join("temp", "test", "plugin");
		const functionPlugin = path.resolve(baseDir, "function_plugin");
		const classPlugin = path.resolve(baseDir, "class_plugin");
		const throwingClassPlugin = path.resolve(baseDir, "throwing_class_plugin");
		const missingClassPlugin = path.resolve(baseDir, "missing_class_plugin");
		const wrongParentClassPlugin = path.resolve(baseDir, "wrong_parent_class_plugin");
		let controller;
		let logger;
		let context;

		before(async function() {
			async function writeEntrypoint(pluginPath, content) {
				await fs.mkdir(pluginPath, { recursive: true });
				await fs.writeFile(path.join(pluginPath, "controller.js"), content);
			}

			await writeEntrypoint(functionPlugin, `
				export default async function(context) {
					context.controller.loadedWith = context;
				}
			`);
			await writeEntrypoint(classPlugin, `
				import { BaseControllerPlugin } from "@clusterio/controller";
				export class ControllerPlugin extends BaseControllerPlugin {
					async init() { this.controller.loadedWith = this; }
					async onSaveData() { }
				}
			`);
			await writeEntrypoint(throwingClassPlugin, `
				import { BaseControllerPlugin } from "@clusterio/controller";
				export class ControllerPlugin extends BaseControllerPlugin {
					async init() { throw new Error("init failed"); }
					async onSaveData() { }
				}
			`);
			await writeEntrypoint(missingClassPlugin, "");
			await writeEntrypoint(wrongParentClassPlugin, "export class ControllerPlugin {};\n");
		});

		beforeEach(function() {
			controller = new mock.MockController();
			logger = new mock.MockLogger();
			logger.warnings = [];
			logger.warn = msg => logger.warnings.push(msg);
			context = { controller, metrics: {}, logger };
		});

		function info(requirePath, entrypoint = "controller.js") {
			return {
				name: "test",
				requirePath,
				packagePath: path.join(requirePath, "package.json"),
				controllerEntrypoint: entrypoint,
			};
		}

		it("should do nothing when the entrypoint is not set", async function() {
			await lib.loadPlugin(
				{ name: "test", requirePath: missingClassPlugin }, "controller", context,
				"ControllerPlugin", BaseControllerPlugin,
			);
			assert.equal(controller.loadedWith, undefined);
		});
		it("should call the default export with the load context", async function() {
			const pluginInfo = info(functionPlugin);
			await lib.loadPlugin(pluginInfo, "controller", context, "ControllerPlugin", BaseControllerPlugin);
			assert.equal(controller.loadedWith.controller, controller);
			assert.equal(controller.loadedWith.plugin, pluginInfo);
			assert.equal(controller.loadedWith.logger, logger);
			assert.deepEqual(logger.warnings, []);
		});
		it("should load a deprecated class export", async function() {
			const pluginInfo = info(classPlugin);
			await lib.loadPlugin(pluginInfo, "controller", context, "ControllerPlugin", BaseControllerPlugin);
			assert(controller.loadedWith instanceof BaseControllerPlugin);
			assert.equal(controller.loadedWith.info, pluginInfo);
			assert.deepEqual([...controller.hooks.save.attached], ["test"]);
			assert.deepEqual(logger.warnings, ["Plugin test is using deprecated class export"]);
		});
		it("should detach hooks if init throws", async function() {
			await assert.rejects(
				lib.loadPlugin(
					info(throwingClassPlugin), "controller", context, "ControllerPlugin", BaseControllerPlugin
				),
				new Error("init failed")
			);
			assert.equal(controller.hooks.size, 0);
		});
		it("should throw if neither a function nor a class is exported", async function() {
			await assert.rejects(
				lib.loadPlugin(
					info(missingClassPlugin), "controller", context, "ControllerPlugin", BaseControllerPlugin
				),
				new Error("Plugin test must export either a default function or ControllerPlugin class")
			);
		});
		it("should throw if the class is not a subclass of the base class", async function() {
			await assert.rejects(
				lib.loadPlugin(
					info(wrongParentClassPlugin), "controller", context, "ControllerPlugin", BaseControllerPlugin
				),
				new Error("Expected ControllerPlugin exported from test to extend BaseControllerPlugin")
			);
		});
	});
	describe("loadPluginList()", async function() {
		const old_cwd = process.cwd();
		const baseDir = path.join("temp", "test", "plugin_list");
		const pluginListPath = path.join(baseDir, "plugin_list.json");
		const localPluginPath = path.join(baseDir, "plugins", "local_plugin");
		const localPluginPathAbs = path.resolve(localPluginPath);
		const externalPluginPath = path.join(baseDir, "external_plugins", "external_plugin");
		const externalPluginPathAbs = path.resolve(externalPluginPath);
		const monorepoPluginPath = path.join(baseDir, "external_plugins", "monorepo", "monorepo_plugin");
		const monorepoPluginPathAbs = path.resolve(monorepoPluginPath);

		const nodeModules = path.join(baseDir, "node_modules");
		const npmPluginPath = path.join(nodeModules, "plugin-npm");
		const npmPluginPathAbs = path.resolve(npmPluginPath);
		const aliasedPluginPath = path.join(nodeModules, "plugin-aliased");
		const deepPluginPath = path.join(nodeModules, "plugin-deep");
		const transitivePluginPath = path.join(nodeModules, "plugin-transitive");
		const nestedPluginPath = path.join(transitivePluginPath, "node_modules", "plugin-nested");
		const hiddenPluginPath = path.join(nodeModules, "plugin-hidden");
		const notAPluginPath = path.join(nodeModules, "not-a-plugin");
		let pluginList;

		before(async function() {
			// Setup test plugins
			async function writePlugin(
				pluginPath,
				name,
				dependencies = {},
				packageJsonFields = {},
			) {
				await fs.mkdir(pluginPath, { recursive: true });
				await fs.writeFile(
					path.join(pluginPath, "index.js"),
					`export const plugin = { name: "${name}" };`
				);
				await fs.writeFile(
					path.join(pluginPath, "package.json"),
					JSON.stringify({
						name: path.basename(pluginPath),
						version: "0.0.1",
						keywords: ["clusterio-plugin"],
						dependencies,
						...packageJsonFields,
					})
				);
			}

			try {
				await fs.rm(baseDir, { force: true, recursive: true, maxRetries: 10 });
			} catch {}

			// Create local plugin
			await writePlugin(localPluginPath, "local");

			// Create external plugin
			await writePlugin(externalPluginPath, "external");

			// Write a monorepo plugin
			await writePlugin(monorepoPluginPath, "monorepo");

			// Create a plugin that is not in root or transitive
			await writePlugin(hiddenPluginPath, "hidden");

			// Create npm plugins
			await writePlugin(npmPluginPath, "npm", { "plugin-transitive": "^1.0.0" });
			await writePlugin(transitivePluginPath, "transitive", { "plugin-npm": "^1.0.0" });
			await writePlugin(nestedPluginPath, "nested");
			await writePlugin(aliasedPluginPath, "aliased", {}, { name: "real-plugin" });

			// Create npm plugin with deep entry point
			await writePlugin(deepPluginPath, "unused", {}, {
				main: "./dist/index.js",
			});
			await fs.mkdir(path.join(deepPluginPath, "dist"));
			await fs.writeFile(
				path.join(deepPluginPath, "dist", "index.js"),
				'export const plugin = { name: "deep" };'
			);

			// Create an npm module that is not a plugin
			await writePlugin(notAPluginPath, "not-a-plugin", { "plugin-hidden": "^0.0.1" }, { keywords: [] });

			// Create root package.json
			await fs.writeFile(
				path.join(baseDir, "package.json"),
				JSON.stringify({
					dependencies: {
						"plugin-npm": "^1.0.0",
						"not-a-plugin": "^1.0.0",
						"plugin-aliased": "npm:real-plugin@^0.0.1",
						"plugin-deep": "^0.0.1",
					},
				})
			);

			process.chdir(baseDir);
			pluginList = await lib.loadPluginList(pluginListPath, true);
		});

		beforeEach(async function() {
			await fs.rm(pluginListPath, { force: true });
		});

		after(async function() {
			process.chdir(old_cwd);
		});

		it("should discover local plugins", async function() {
			assert.ok(pluginList.has("local_plugin"));
			assert.ok(pluginList.has("external_plugin"));
			assert.strictEqual(pluginList.get("local_plugin"), localPluginPathAbs);
			assert.strictEqual(pluginList.get("external_plugin"), externalPluginPathAbs);
		});

		it("should discover npm plugins", async function() {
			assert.ok(pluginList.has("npm"));
			assert.strictEqual(pluginList.get("npm"), "plugin-npm");
			assert.strictEqual(pluginList.get("aliased"), "plugin-aliased");
			assert.strictEqual(pluginList.get("deep"), "plugin-deep");
			assert.strictEqual(pluginList.get("not-a-plugin"), undefined);
		});

		it("should discover transitive npm plugins without traversing non-plugin packages", async function() {
			assert.strictEqual(pluginList.get("transitive"), "plugin-transitive");
			assert.strictEqual(pluginList.get("nested"), undefined);
			assert.strictEqual(pluginList.get("hidden"), undefined);
		});

		it("should list installed versions and plugins pending a restart", async function() {
			const pluginInfos = [{
				name: "npm",
				title: "NPM",
				version: "0.0.0",
				requirePath: npmPluginPathAbs,
				packagePath: path.join(npmPluginPathAbs, "package.json"),
				npmPackage: "plugin-npm",
			}];
			const plugins = await lib.listPluginDetails(pluginInfos, () => true, () => true, new Map());
			const byPackage = new Map(plugins.map(plugin => [plugin.npmPackage ?? plugin.name, plugin]));

			const loaded = byPackage.get("plugin-npm");
			assert.equal(loaded.version, "0.0.0");
			assert.equal(loaded.installedVersion, "0.0.1");
			assert.equal(loaded.pendingInstall, undefined);

			// Dependencies of plugin packages are found the same way as on startup
			for (const packageName of ["plugin-aliased", "plugin-deep", "plugin-transitive"]) {
				const pending = byPackage.get(packageName);
				assert.equal(pending.pendingInstall, true, packageName);
				assert.equal(pending.installedVersion, "0.0.1", packageName);
				assert.equal(pending.loaded, false, packageName);
			}
			// An alias installs a different package than its dependency name
			assert.equal(byPackage.get("plugin-aliased").npmPackage, undefined);
			assert.equal(byPackage.get("plugin-deep").npmPackage, "plugin-deep");
			assert.equal(byPackage.has("not-a-plugin"), false);
			assert.equal(byPackage.has("plugin-hidden"), false);
			assert.equal(plugins.length, 4);
		});

		it("should not list a plugin loaded from a path as pending when npm links to it", async function() {
			const rootPackageJson = await fs.readFile("package.json", "utf8");
			const linkPath = path.join("node_modules", "plugin-linked");
			try {
				await fs.symlink(externalPluginPathAbs, linkPath, "junction");
				await fs.writeFile("package.json", JSON.stringify({
					dependencies: { "plugin-linked": "file:external_plugins/external_plugin" },
				}));
				const plugins = await lib.listPluginDetails([{
					name: "external",
					title: "External",
					version: "0.0.1",
					requirePath: externalPluginPathAbs,
					packagePath: path.join(externalPluginPathAbs, "package.json"),
				}], () => true, () => true, new Map());
				assert.deepEqual(plugins.map(plugin => plugin.name), ["external"]);
			} finally {
				await fs.writeFile("package.json", rootPackageJson);
				await fs.rm(linkPath, { force: true });
			}
		});

		it("should record npm plugins skipped because their name is taken", async function() {
			await fs.writeFile(pluginListPath, JSON.stringify([["npm", localPluginPathAbs]]));
			const skipped = new Map();
			const list = await lib.loadPluginList(pluginListPath, false, skipped);
			assert.equal(list.get("npm"), localPluginPathAbs);
			assert.deepEqual([...skipped], [[await fs.realpath(npmPluginPathAbs), "npm"]]);
		});

		it("should not record npm plugins already in the list as skipped", async function() {
			await fs.writeFile(pluginListPath, JSON.stringify([["npm", "plugin-npm"]]));
			const skipped = new Map();
			await lib.loadPluginList(pluginListPath, false, skipped);
			assert.deepEqual([...skipped], []);
		});

		it("should not give plugins from a path, git or url an npm package on startup", async function() {
			const rootPackageJson = await fs.readFile("package.json", "utf8");
			try {
				const root = JSON.parse(rootPackageJson);
				root.dependencies["plugin-npm"] = "github:user/plugin-npm";
				await fs.writeFile("package.json", JSON.stringify(root));
				// loadPluginInfos resolves from where lib is installed, which can't reach these fixtures
				const dirs = await lib.findNonRegistryDirs();
				assert.equal(dirs.has(await fs.realpath(npmPluginPathAbs)), true);
				assert.equal(dirs.has(await fs.realpath(path.resolve(old_cwd, deepPluginPath))), false);
			} finally {
				await fs.writeFile("package.json", rootPackageJson);
			}
		});

		it("should treat tarball dependencies as not from the registry", function() {
			assert.equal(lib.isRegistrySpec("plugin-x-1.0.0.tgz"), false);
			assert.equal(lib.isRegistrySpec("plugin-x.tar.gz"), false);
			assert.equal(lib.isRegistrySpec("^1.0.0"), true);
			assert.equal(lib.isRegistrySpec("latest"), true);
		});

		it("should replace plugin list entries that no longer exist with npm plugins", async function() {
			const gone = path.resolve("plugins", "gone");
			await fs.writeFile(pluginListPath, JSON.stringify([["npm", gone], ["aliased", "plugin-gone"]]));
			const skipped = new Map();
			const list = await lib.loadPluginList(pluginListPath, false, skipped);
			assert.equal(list.get("npm"), "plugin-npm");
			assert.equal(list.get("aliased"), "plugin-aliased");
			assert.deepEqual([...skipped], []);
			const saved = new Map(JSON.parse(await fs.readFile(pluginListPath, "utf8")));
			assert.equal(saved.get("npm"), "plugin-npm");
		});

		it("should list npm plugins skipped on startup as not loading while their name is taken", async function() {
			const skipped = new Map([[await fs.realpath(npmPluginPathAbs), "npm"]]);
			const local = {
				name: "npm",
				title: "Local",
				version: "0.0.1",
				requirePath: localPluginPathAbs,
				packagePath: path.join(localPluginPathAbs, "package.json"),
			};
			let plugins = await lib.listPluginDetails([local], () => true, () => true, skipped);
			const taken = plugins.find(plugin => plugin.name === "plugin-npm");
			assert.equal(taken.nameTaken, true);
			assert.equal(taken.pendingInstall, undefined);

			// Loaded on the next restart once the plugin with that name is gone
			const gone = { ...local, packagePath: path.resolve("plugins", "gone", "package.json") };
			plugins = await lib.listPluginDetails([gone], () => true, () => true, skipped);
			assert.equal(plugins.find(plugin => plugin.name === "plugin-npm").pendingInstall, true);
		});

		it("should list a dependency made direct since startup as pending", async function() {
			// npm leaves the hoisted package untouched when it becomes a direct dependency
			const rootPackageJson = await fs.readFile("package.json", "utf8");
			try {
				const root = JSON.parse(rootPackageJson);
				root.dependencies["plugin-hidden"] = "^0.0.1";
				await fs.writeFile("package.json", JSON.stringify(root));
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				const hidden = plugins.find(plugin => plugin.name === "plugin-hidden");
				assert.equal(hidden.pendingInstall, true);
				assert.equal(hidden.npmPackage, "plugin-hidden");
			} finally {
				await fs.writeFile("package.json", rootPackageJson);
			}
		});

		it("should not list plugins nested under another package as pending", async function() {
			// Startup loads plugins by package name from the root, which doesn't reach nested packages
			const packageJsonPath = path.join("node_modules", "plugin-transitive", "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			try {
				const packageJson = JSON.parse(original);
				packageJson.dependencies["plugin-nested"] = "^0.0.1";
				await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				assert.equal(plugins.some(plugin => plugin.name === "plugin-nested"), false);
				assert.ok(plugins.some(plugin => plugin.name === "plugin-transitive"));
			} finally {
				await fs.writeFile(packageJsonPath, original);
			}
		});

		it("should not list packages from a path, git or url as installable from npm", async function() {
			const rootPackageJson = await fs.readFile("package.json", "utf8");
			try {
				const root = JSON.parse(rootPackageJson);
				root.dependencies["plugin-npm"] = "file:../plugin-npm";
				root.dependencies["plugin-deep"] = "github:user/plugin-deep";
				await fs.writeFile("package.json", JSON.stringify(root));
				const plugins = await lib.listPluginDetails([{
					name: "npm",
					title: "NPM",
					version: "0.0.1",
					requirePath: "plugin-npm",
					packagePath: path.join(npmPluginPathAbs, "package.json"),
					npmPackage: "plugin-npm",
				}], () => true, () => true, new Map());
				const npm = plugins.find(plugin => plugin.name === "npm");
				assert.equal(npm.npmPackage, undefined);
				assert.equal(npm.dependencyName, "plugin-npm");
				const deep = plugins.find(plugin => plugin.name === "plugin-deep");
				assert.equal(deep.pendingInstall, true);
				assert.equal(deep.npmPackage, undefined);
			} finally {
				await fs.writeFile("package.json", rootPackageJson);
			}
		});

		it("should not list plugins another plugin installs from a path, git or url as installable", async function() {
			const packageJsonPath = path.join("node_modules", "plugin-npm", "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			try {
				const packageJson = JSON.parse(original);
				packageJson.dependencies["plugin-transitive"] = "github:user/plugin-transitive";
				await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
				const transitive = {
					name: "transitive",
					title: "Transitive",
					version: "0.0.1",
					requirePath: "plugin-transitive",
					packagePath: path.resolve(old_cwd, transitivePluginPath, "package.json"),
					npmPackage: "plugin-transitive",
				};
				const [loaded] = await lib.listPluginDetails([transitive], () => true, () => true, new Map());
				assert.equal(loaded.npmPackage, undefined);
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				const pending = plugins.find(plugin => plugin.name === "plugin-transitive");
				assert.equal(pending.npmPackage, undefined);
				assert.equal(await lib.isNonRegistryPackage("plugin-transitive"), true);
				assert.equal(await lib.isNonRegistryPackage("plugin-npm"), false);
			} finally {
				await fs.writeFile(packageJsonPath, original);
			}
		});

		it("should not list a plugin replaced by another package since startup as installable", async function() {
			const packageJsonPath = path.join("node_modules", "plugin-npm", "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			try {
				await fs.writeFile(packageJsonPath, JSON.stringify({ ...JSON.parse(original), name: "other" }));
				const [plugin] = await lib.listPluginDetails([{
					name: "npm",
					title: "NPM",
					version: "0.0.1",
					requirePath: "plugin-npm",
					packagePath: path.join(npmPluginPathAbs, "package.json"),
					npmPackage: "plugin-npm",
				}], () => true, () => true, new Map());
				assert.equal(plugin.npmPackage, undefined);
				assert.equal(plugin.removed, undefined);
			} finally {
				await fs.writeFile(packageJsonPath, original);
			}
		});

		it("should not list private packages as installable from npm", async function() {
			const packageJsonPath = path.join("node_modules", "plugin-deep", "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			try {
				await fs.writeFile(packageJsonPath, JSON.stringify({ ...JSON.parse(original), private: true }));
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				const deep = plugins.find(plugin => plugin.name === "plugin-deep");
				assert.equal(deep.pendingInstall, true);
				assert.equal(deep.npmPackage, undefined);
			} finally {
				await fs.writeFile(packageJsonPath, original);
			}
		});

		it("should skip packages whose package.json is being rewritten", async function() {
			const packageJsonPath = path.join("node_modules", "plugin-deep", "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			try {
				await fs.writeFile(packageJsonPath, original.slice(0, 20));
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				assert.equal(plugins.some(plugin => plugin.name === "plugin-deep"), false);
				assert.ok(plugins.some(plugin => plugin.name === "plugin-aliased"));
			} finally {
				await fs.writeFile(packageJsonPath, original);
			}
		});

		it("should skip packages with a malformed package.json before they are first resolved", async function() {
			const rootPackageJson = await fs.readFile("package.json", "utf8");
			const brokenPath = path.join("node_modules", "plugin-half-written");
			try {
				await fs.mkdir(brokenPath, { recursive: true });
				await fs.writeFile(path.join(brokenPath, "package.json"), '{ "name": "plugin-half');
				const root = JSON.parse(rootPackageJson);
				root.dependencies["plugin-half-written"] = "^1.0.0";
				await fs.writeFile("package.json", JSON.stringify(root));
				const plugins = await lib.listPluginDetails([], () => true, () => true, new Map());
				assert.equal(plugins.some(plugin => plugin.name === "plugin-half-written"), false);
				assert.ok(plugins.some(plugin => plugin.name === "plugin-aliased"));
			} finally {
				await fs.writeFile("package.json", rootPackageJson);
				await fs.rm(brokenPath, { recursive: true, force: true });
			}
		});

		it("should not plan installing over an alias loaded on another machine", async function() {
			// As loadPluginInfos returns it for the aliased plugin found on startup
			assert.equal(pluginList.get("aliased"), "plugin-aliased");
			const aliasInfo = {
				name: "aliased",
				title: "Aliased",
				version: "0.0.1",
				requirePath: "plugin-aliased",
				packagePath: path.resolve("node_modules", "plugin-aliased", "package.json"),
				npmPackage: undefined,
			};
			const hostB = await lib.listPluginDetails([aliasInfo], () => true, () => true, new Map());
			const alias = hostB.find(plugin => plugin.name === "aliased");
			assert.equal(alias.dependencyName, "plugin-aliased");
			assert.equal(alias.npmPackage, undefined);

			const published = new lib.PluginDetails(
				"published", "Published", "1.0.0", true, true, undefined, "plugin-aliased", "1.0.0",
			);
			const statuses = computePluginStatuses([
				{ name: "A", isController: false, address: { hostId: 1 }, plugins: [published] },
				{ name: "B", isController: false, address: { hostId: 2 }, plugins: hostB },
			]);
			const plan = planUpdate(
				statuses.get("plugin-aliased"), "2.0.0",
				{ canInstall: () => true, canUpdate: () => true }, { hasPermission: () => true },
			);
			assert.deepEqual(plan.operations.map(operation => operation.target.name), ["A"]);
			assert.deepEqual(
				plan.skipped.map(skip => skip.text), ["B (another package is installed as plugin-aliased)"],
			);
		});

		it("should mark plugins uninstalled since startup as removed", async function() {
			const pluginInfos = [{
				name: "gone",
				title: "Gone",
				version: "1.0.0",
				requirePath: "plugin-gone",
				packagePath: path.resolve("node_modules", "plugin-gone", "package.json"),
				npmPackage: "plugin-gone",
			}, {
				name: "npm",
				title: "NPM",
				version: "0.0.1",
				requirePath: npmPluginPathAbs,
				packagePath: path.join(npmPluginPathAbs, "package.json"),
				npmPackage: "plugin-npm",
			}];
			const plugins = await lib.listPluginDetails(pluginInfos, () => true, () => true, new Map());
			const byPackage = new Map(plugins.map(plugin => [plugin.npmPackage ?? plugin.name, plugin]));
			assert.equal(byPackage.get("plugin-gone").removed, true);
			assert.equal(byPackage.get("plugin-gone").installedVersion, undefined);
			assert.equal(byPackage.get("plugin-npm").removed, undefined);
		});

		it("should load existing plugin list", async function() {
			const existingList = new Map([["test", "/test/path"]]);
			await fs.writeFile(pluginListPath, JSON.stringify([...existingList]));
			const loadedPlugins = await lib.loadPluginList(pluginListPath, false);
			assert.ok(loadedPlugins.has("test"));
			assert.strictEqual(loadedPlugins.get("test"), "/test/path");
		});

		it("should support monorepo plugins", async function() {
			assert.ok(pluginList.has("monorepo_plugin"));
			assert.strictEqual(pluginList.get("monorepo_plugin"), monorepoPluginPathAbs);
		});

		it("should not throw when package.json has no dependencies field", async function() {
			// Create a package.json without dependencies
			await fs.writeFile(
				path.join("package.json"),
				JSON.stringify({
					name: "test-package",
					version: "1.0.0",
				})
			);

			// Should not throw
			await assert.doesNotReject(async () => {
				await lib.loadPluginList(pluginListPath, true);
			});
		});
	});
});
