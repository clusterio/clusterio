import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import t from "tap";
import * as lib from "@clusterio/lib";

type Fixture = Record<string, any>;

// Specs that are not absolute paths resolve from plugin_info.js
const pluginInfoDir = path.dirname(fileURLToPath(import.meta.resolve("@clusterio/lib/dist/node/src/plugin_info.js")));
function specFor(dir: string) {
	return path.relative(pluginInfoDir, dir).split(path.sep).join("/");
}

/** Plugin package fixture exporting plugin from index.js */
function pluginPackage(pluginName: string, packageFields: Record<string, unknown> = {}, plugin = "{}"): Fixture {
	return {
		"package.json": JSON.stringify({ version: "0.0.1", type: "module", ...packageFields }),
		"index.js": `export const plugin = { name: ${JSON.stringify(pluginName)}, ...${plugin} };`,
	};
}

/** Plugin package that npm would install, as found by listPluginDetails */
function npmPackage(name: string, fields: Record<string, unknown> = {}, dependencies: Record<string, string> = {}) {
	return {
		"package.json": JSON.stringify({
			name, version: "0.0.1", keywords: ["clusterio-plugin"], dependencies, ...fields,
		}),
	};
}

/** Create the fixture and make it the working directory for the rest of the test */
function cwdFixture(t1: any, fixture: Fixture) {
	const dir = t1.testdir(fixture);
	const oldCwd = process.cwd();
	process.chdir(dir);
	t1.teardown(() => process.chdir(oldCwd));
	return dir;
}

function captureLogs(t1: any) {
	const logs = { errors: [] as string[], warnings: [] as string[] };
	t1.intercept(lib.logger, "error", { value: (msg: string) => { logs.errors.push(msg); } });
	t1.intercept(lib.logger, "warn", { value: (msg: string) => { logs.warnings.push(msg); } });
	return logs;
}

/** Plugin info as loadPluginInfos returns it for a package directory */
function nodeEnvInfo(name: string, packageDir: string, fields: Partial<lib.PluginNodeEnvInfo> = {}) {
	return {
		name,
		title: name,
		version: "0.0.1",
		requirePath: packageDir,
		packagePath: path.join(packageDir, "package.json"),
		webStaticPath: path.join(packageDir, "dist", "web", "static"),
		...fields,
	} as lib.PluginNodeEnvInfo;
}

const always = () => true;

t.test("loadPluginInfos()", async t1 => {
	t1.test("loads a plugin from a path", async t2 => {
		const dir = cwdFixture(t2, { test_plugin: pluginPackage("test") });
		const pluginDir = path.join(dir, "test_plugin");
		t2.strictSame(await lib.loadPluginInfos(new Map([["test", pluginDir]])), [{
			name: "test",
			version: "0.0.1",
			npmPackage: undefined,
			skippedNpmPackage: undefined,
			packagePath: path.join(pluginDir, "package.json"),
			requirePath: pluginDir,
			webStaticPath: path.join(pluginDir, "dist", "web", "static"),
		}]);
	});
	t1.test("loads the main file from package.json", async t2 => {
		const dir = cwdFixture(t2, {
			deep: {
				"package.json": JSON.stringify({ version: "1.0.0", main: "dist/index.js", type: "module" }),
				dist: { "index.js": "export const plugin = { name: \"deep\" };" },
			},
		});
		const [info] = await lib.loadPluginInfos(new Map([["deep", path.join(dir, "deep")]]));
		t2.equal(info.name, "deep");
		t2.equal(info.version, "1.0.0");
	});
	t1.test("records the npm package skipped for a plugin", async t2 => {
		const dir = cwdFixture(t2, { test_plugin: pluginPackage("test") });
		const [info] = await lib.loadPluginInfos(
			new Map([["test", path.join(dir, "test_plugin")]]),
			new Map([["test", "/skipped"], ["other", "/other"]]),
		);
		t2.equal(info.skippedNpmPackage, "/skipped");
	});
	t1.test("drops missing plugins from the list", async t2 => {
		const dir = cwdFixture(t2, { no_package: { "index.js": "" }, test_plugin: pluginPackage("test") });
		const logs = captureLogs(t2);
		const missing = path.join(dir, "missing");
		const noPackage = path.join(dir, "no_package");
		const testPlugin = path.join(dir, "test_plugin");
		const list = new Map([
			["missing", missing], ["no_package", noPackage], ["unknown", "clusterio-test-unknown-package"],
			["test", testPlugin],
		]);
		const infos = await lib.loadPluginInfos(list);
		t2.strictSame(infos.map(info => info.name), ["test"]);
		t2.strictSame([...list], [["test", testPlugin]]);
		t2.strictSame(logs.errors, [
			`Plugin path ${missing} does not exist, not loading missing`,
			`Plugin path ${noPackage} missing index or main file, not loading no_package`,
			"Plugin path clusterio-test-unknown-package does not exist, not loading unknown",
		]);
	});
	t1.test("rejects with PluginError when the plugin can't be imported", async t2 => {
		const dir = cwdFixture(t2, {
			broken: { "package.json": '{ "version": "0.0.1" }', "index.js": "Syntax Error" },
			no_main: { "package.json": '{ "version": "0.0.1" }' },
			bad_json: { "package.json": '{ "version": ', "index.js": "" },
		});
		for (const name of ["broken", "no_main", "bad_json"]) {
			const err = await lib.loadPluginInfos(new Map([[name, path.join(dir, name)]])).catch(e => e);
			t2.ok(err instanceof lib.PluginError, name);
			t2.equal(err.pluginName, name);
			t2.equal(err.message, `PluginError: ${err.original.message}`);
		}
	});
	t1.test("passes on installation errors from the plugin", async t2 => {
		const dir = cwdFixture(t2, {
			plugin: {
				"package.json": '{ "version": "0.0.1", "type": "module" }',
				"index.js": "import { InstallationError } from \"@clusterio/lib\";\n" +
					"throw new InstallationError(\"run npm install\");",
			},
		});
		await t2.rejects(
			lib.loadPluginInfos(new Map([["plugin", path.join(dir, "plugin")]])),
			new lib.InstallationError("run npm install"),
		);
	});
	t1.test("rejects a plugin without a plugin export", async t2 => {
		const dir = cwdFixture(t2, {
			plugin: {
				"package.json": '{ "version": "0.0.1", "type": "module" }',
				"index.js": "export const other = 1;",
			},
		});
		const pluginDir = path.join(dir, "plugin");
		await t2.rejects(
			lib.loadPluginInfos(new Map([["plugin", pluginDir]])),
			new lib.EnvironmentError(
				`Expected plugin at ${pluginDir} to export an object named 'plugin' but got undefined`,
			),
		);
	});
	t1.test("rejects a plugin with a different name", async t2 => {
		const dir = cwdFixture(t2, { invalid: pluginPackage("wrong") });
		const pluginDir = path.join(dir, "invalid");
		await t2.rejects(
			lib.loadPluginInfos(new Map([["invalid", pluginDir]])),
			new lib.EnvironmentError(`Expected plugin at ${pluginDir} to be named invalid but got wrong`),
		);
	});
	t1.test("rejects invalid requiredMods", async t2 => {
		const dir = cwdFixture(t2, {
			prefixed: pluginPackage("prefixed", {}, "{ requiredMods: [\"? optional_mod\"] }"),
			valid: pluginPackage("valid", {}, "{ requiredMods: [\"base >= 2.0.0\", \"clusterio_lib\"] }"),
		});
		await t2.rejects(lib.loadPluginInfos(new Map([["prefixed", path.join(dir, "prefixed")]])), {
			name: "PluginError",
			pluginName: "prefixed",
			message: "PluginError: requiredMods entry \"? optional_mod\" can not have a dependency prefix",
		});
		const [info] = await lib.loadPluginInfos(new Map([["valid", path.join(dir, "valid")]]));
		t2.strictSame(info.requiredMods, ["base >= 2.0.0", "clusterio_lib"]);
	});
	t1.test("ignores plugins from before alpha 14", async t2 => {
		const dir = cwdFixture(t2, {
			old: pluginPackage("old", {}, "{ messages: { foo: {} } }"),
			current: pluginPackage("current", {}, "{ messages: [] }"),
		});
		const logs = captureLogs(t2);
		const list = new Map([["old", path.join(dir, "old")], ["current", path.join(dir, "current")]]);
		const infos = await lib.loadPluginInfos(list);
		t2.strictSame(infos.map(info => info.name), ["current"]);
		t2.strictSame(logs.warnings, ["Ignoring incompatible pre alpha.14 plugin old"]);
		t2.equal(list.size, 2, "stays in the plugin list");
	});

	// npm installed plugins are listed by name and resolved from lib, a relative spec stands in for the name
	t1.test("sets npmPackage when loaded by its package name", async t2 => {
		const dir = cwdFixture(t2, { "package.json": "{}", plugin: {} });
		const spec = specFor(path.join(dir, "plugin"));
		await fs.writeFile(path.join(dir, "plugin", "package.json"), JSON.stringify({ name: spec, version: "2.0.0" }));
		await fs.writeFile(path.join(dir, "plugin", "index.js"), "export const plugin = { name: \"npm\" };");
		const [info] = await lib.loadPluginInfos(new Map([["npm", spec]]));
		t2.equal(info.npmPackage, spec);
		t2.equal(info.requirePath, spec);
		t2.equal(info.packagePath, path.join(dir, "plugin", "package.json"));
	});
	t1.test("leaves out npmPackage for private packages", async t2 => {
		const dir = cwdFixture(t2, { plugin: {} });
		const spec = specFor(path.join(dir, "plugin"));
		await fs.writeFile(
			path.join(dir, "plugin", "package.json"),
			JSON.stringify({ name: spec, version: "2.0.0", private: true }),
		);
		await fs.writeFile(path.join(dir, "plugin", "index.js"), "export const plugin = { name: \"npm\" };");
		const [info] = await lib.loadPluginInfos(new Map([["npm", spec]]));
		t2.equal(info.npmPackage, undefined);
	});
	t1.test("leaves out npmPackage for a different package name", async t2 => {
		const dir = cwdFixture(t2, { plugin: pluginPackage("npm", { name: "plugin-npm" }) });
		const [info] = await lib.loadPluginInfos(new Map([["npm", specFor(path.join(dir, "plugin"))]]));
		t2.equal(info.npmPackage, undefined);
	});
	t1.test("leaves out npmPackage for packages installed from a path, git or url", async t2 => {
		const dir = cwdFixture(t2, {
			"package.json": JSON.stringify({ dependencies: { "plugin-linked": "file:plugin" } }),
			plugin: {},
		});
		const spec = specFor(path.join(dir, "plugin"));
		await fs.writeFile(
			path.join(dir, "plugin", "package.json"),
			JSON.stringify({ name: spec, version: "2.0.0", keywords: ["clusterio-plugin"] }),
		);
		await fs.writeFile(path.join(dir, "plugin", "index.js"), "export const plugin = { name: \"npm\" };");
		await fs.mkdir(path.join(dir, "node_modules"));
		await fs.symlink(path.join(dir, "plugin"), path.join(dir, "node_modules", "plugin-linked"), "junction");
		const [info] = await lib.loadPluginInfos(new Map([["npm", spec]]));
		t2.equal(info.npmPackage, undefined);
	});
});

t.test("listPluginDetails()", async t1 => {
	// Root with plugin-a and plugin-b, plugin-b depends on plugin-c
	const fixture = (rootDependencies: Record<string, string> = {}, modules: Fixture = {}) => ({
		"package.json": JSON.stringify({
			dependencies: { "plugin-a": "^1.0.0", "plugin-b": "^1.0.0", ...rootDependencies },
		}),
		node_modules: {
			"plugin-a": npmPackage("plugin-a", { version: "1.1.0" }),
			"plugin-b": npmPackage("plugin-b", { description: "B" }, { "plugin-c": "^1.0.0" }),
			"plugin-c": npmPackage("plugin-c"),
			...modules,
		},
		local: npmPackage("local"),
	});

	t1.test("lists loaded plugins with their state and installed version", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const a = nodeEnvInfo("a", path.join(dir, "node_modules", "plugin-a"), {
			requirePath: "plugin-a", npmPackage: "plugin-a", version: "1.0.0", description: "A",
		});
		const [details] = await lib.listPluginDetails([a], always, always);
		t2.strictSame(
			details,
			new lib.PluginDetails("a", "a", "1.0.0", "loaded", "A", "plugin-a", "1.1.0", "plugin-a"),
		);
	});
	t1.test("sets the state from isLoaded, isEnabled and hasEntrypoint", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const local = nodeEnvInfo("local", path.join(dir, "local"));
		const state = async (loaded: boolean, enabled: boolean, entrypoint?: boolean) => {
			const [details] = await lib.listPluginDetails(
				[local], () => loaded, () => enabled, entrypoint === undefined ? undefined : () => entrypoint,
			);
			return details.state;
		};
		t2.equal(await state(true, true), "loaded");
		t2.equal(await state(true, false), "unloadOnRestart");
		t2.equal(await state(false, true), "loadOnRestart");
		t2.equal(await state(false, false), "disabled");
		t2.equal(await state(true, true, true), "loaded");
		t2.equal(await state(false, false, false), "noEntrypoint");
	});
	t1.test("passes the plugin info to the callbacks", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const local = nodeEnvInfo("local", path.join(dir, "local"));
		const seen: unknown[] = [];
		const record = (result: boolean) => (info: unknown) => { seen.push(info); return result; };
		await lib.listPluginDetails([local], record(true), record(true), record(true));
		t2.equal(seen.length, 3);
		t2.ok(seen.every(info => info === local));
	});
	t1.test("lists plugins installed since startup as pending", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const a = nodeEnvInfo("a", path.join(dir, "node_modules", "plugin-a"), { requirePath: "plugin-a" });
		const plugins = await lib.listPluginDetails([a], always, always);
		t2.strictSame(plugins.slice(1), [
			new lib.PluginDetails(
				"plugin-b", "plugin-b", "0.0.1", "pendingInstall", "B", "plugin-b", "0.0.1", "plugin-b",
			),
			new lib.PluginDetails("plugin-c", "plugin-c", "0.0.1", "pendingInstall", undefined, "plugin-c", "0.0.1"),
		]);
	});
	t1.test("lists nothing without a root package.json", async t2 => {
		cwdFixture(t2, {});
		t2.strictSame(await lib.listPluginDetails([], always, always), []);
	});
	t1.test("does not list a plugin loaded from a path as pending when npm links to it", async t2 => {
		const dir = cwdFixture(t2, {
			...fixture({ "plugin-linked": "file:local" }),
		});
		await fs.symlink(path.join(dir, "local"), path.join(dir, "node_modules", "plugin-linked"), "junction");
		const local = nodeEnvInfo("local", path.join(dir, "local"));
		const plugins = await lib.listPluginDetails([local], always, always);
		t2.strictSame(plugins.map(plugin => plugin.name), ["local", "plugin-a", "plugin-b", "plugin-c"]);
	});
	t1.test("does not list plugins nested under another package", async t2 => {
		cwdFixture(t2, fixture({}, {
			"plugin-b": {
				...npmPackage("plugin-b", {}, { "plugin-nested": "^1.0.0" }),
				node_modules: { "plugin-nested": npmPackage("plugin-nested") },
			},
		}));
		const plugins = await lib.listPluginDetails([], always, always);
		t2.strictSame(plugins.map(plugin => plugin.name), ["plugin-a", "plugin-b"]);
	});
	t1.test("skips packages without a version", async t2 => {
		cwdFixture(t2, fixture({}, { "plugin-a": npmPackage("plugin-a", { version: 1 }) }));
		const plugins = await lib.listPluginDetails([], always, always);
		t2.strictSame(plugins.map(plugin => plugin.name), ["plugin-b", "plugin-c"]);
	});
	t1.test("skips packages whose package.json is being rewritten", async t2 => {
		cwdFixture(t2, fixture({}, { "plugin-a": { "package.json": '{ "name": "plugin-a", "keyw' } }));
		const plugins = await lib.listPluginDetails([], always, always);
		t2.strictSame(plugins.map(plugin => plugin.name), ["plugin-b", "plugin-c"]);
	});
	t1.test("keeps a loaded plugin whose package.json is being rewritten", async t2 => {
		const dir = cwdFixture(t2, fixture({}, { "plugin-a": { "package.json": '{ "name": "plugin-a", "keyw' } }));
		const a = nodeEnvInfo("a", path.join(dir, "node_modules", "plugin-a"), {
			requirePath: "plugin-a", npmPackage: "plugin-a",
		});
		const [details] = await lib.listPluginDetails([a], always, always);
		t2.equal(details.state, "loaded");
		t2.equal(details.installedVersion, undefined);
		t2.equal(details.npmPackage, "plugin-a");
	});
	t1.test("does not list private packages as installable from npm", async t2 => {
		cwdFixture(t2, fixture({}, { "plugin-a": npmPackage("plugin-a", { private: true }) }));
		const plugins = await lib.listPluginDetails([], always, always);
		const a = plugins.find(plugin => plugin.name === "plugin-a")!;
		t2.equal(a.state, "pendingInstall");
		t2.equal(a.npmPackage, undefined);
		t2.equal(a.dependencyName, "plugin-a");
	});
	t1.test("does not list an alias as installable from npm", async t2 => {
		cwdFixture(t2, fixture({ "plugin-alias": "npm:real-plugin@^1.0.0" }, {
			"plugin-alias": npmPackage("real-plugin"),
		}));
		const plugins = await lib.listPluginDetails([], always, always);
		const alias = plugins.find(plugin => plugin.name === "plugin-alias")!;
		t2.equal(alias.npmPackage, undefined);
		t2.equal(alias.dependencyName, "plugin-alias");
	});
	t1.test("does not list packages from a path, git or url as installable", async t2 => {
		const dir = cwdFixture(t2, fixture({ "plugin-a": "github:user/plugin-a" }, {
			"plugin-b": npmPackage("plugin-b", {}, { "plugin-c": "file:../c" }),
		}));
		const a = nodeEnvInfo("a", path.join(dir, "node_modules", "plugin-a"), {
			requirePath: "plugin-a", npmPackage: "plugin-a",
		});
		const plugins = await lib.listPluginDetails([a], always, always);
		t2.equal(plugins[0].npmPackage, undefined);
		t2.equal(plugins[0].dependencyName, "plugin-a");
		t2.equal(plugins.find(plugin => plugin.name === "plugin-c")!.npmPackage, undefined);
		t2.equal(plugins.find(plugin => plugin.name === "plugin-b")!.npmPackage, "plugin-b");
	});
	t1.test("does not list a plugin replaced by another package since startup as installable", async t2 => {
		const dir = cwdFixture(t2, fixture({}, { "plugin-a": npmPackage("other") }));
		const a = nodeEnvInfo("a", path.join(dir, "node_modules", "plugin-a"), {
			requirePath: "plugin-a", npmPackage: "plugin-a",
		});
		const [details] = await lib.listPluginDetails([a], always, always);
		t2.equal(details.npmPackage, undefined);
		t2.equal(details.state, "loaded");
		t2.equal(details.installedVersion, "0.0.1");
	});
	t1.test("marks plugins uninstalled since startup as removed", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const gone = nodeEnvInfo("gone", path.join(dir, "node_modules", "plugin-gone"), {
			requirePath: "plugin-gone", npmPackage: "plugin-gone",
		});
		const [loaded] = await lib.listPluginDetails([gone], always, always);
		t2.equal(loaded.state, "removedLoaded");
		t2.equal(loaded.installedVersion, undefined);
		const [disabled] = await lib.listPluginDetails([gone], () => false, () => false);
		t2.equal(disabled.state, "removed");
	});
	t1.test("lists npm plugins skipped on startup as nameTaken while their name is taken", async t2 => {
		const dir = cwdFixture(t2, fixture());
		const local = nodeEnvInfo("a", path.join(dir, "local"), {
			skippedNpmPackage: await fs.realpath(path.join(dir, "node_modules", "plugin-a")),
		});
		let plugins = await lib.listPluginDetails([local], always, always);
		t2.equal(plugins.find(plugin => plugin.name === "plugin-a")!.state, "nameTaken");

		// Loaded on the next restart once the plugin with that name is gone
		const gone = { ...local, packagePath: path.join(dir, "gone", "package.json") };
		plugins = await lib.listPluginDetails([gone], always, always);
		t2.equal(plugins.find(plugin => plugin.name === "plugin-a")!.state, "pendingInstall");
	});
});
