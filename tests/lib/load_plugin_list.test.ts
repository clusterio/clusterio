import fs from "node:fs/promises";
import path from "node:path";
import t from "tap";
import * as lib from "@clusterio/lib";

type Fixture = Record<string, any>;

/** Package directory fixture, a plugin unless keywords are given */
function pkg(name: string, options: {
	pluginName?: string,
	dependencies?: Record<string, string>,
	fields?: Record<string, unknown>,
} = {}): Fixture {
	return {
		"package.json": JSON.stringify({
			name,
			version: "0.0.1",
			type: "module",
			keywords: ["clusterio-plugin"],
			dependencies: options.dependencies ?? {},
			...options.fields,
		}),
		"index.js": `export const plugin = { name: ${JSON.stringify(options.pluginName ?? name)} };`,
	};
}

function notPlugin(name: string, dependencies: Record<string, string> = {}) {
	return pkg(name, { dependencies, fields: { keywords: [] } });
}

function rootPackage(dependencies: Record<string, string>, fields: Record<string, unknown> = {}) {
	return JSON.stringify({ name: "root", private: true, dependencies, ...fields });
}

/** Create the fixture and make it the working directory for the rest of the test */
function cwdFixture(t1: any, fixture: Fixture) {
	const dir = t1.testdir(fixture);
	const oldCwd = process.cwd();
	process.chdir(dir);
	t1.teardown(() => process.chdir(oldCwd));
	return dir;
}

/** Record logger info and warn messages for the test */
function captureLogs(t1: any) {
	const logs = { infos: [] as string[], warnings: [] as string[] };
	t1.intercept(lib.logger, "info", { value: (msg: string) => { logs.infos.push(msg); } });
	t1.intercept(lib.logger, "warn", { value: (msg: string) => { logs.warnings.push(msg); } });
	return logs;
}

async function readList(file: string) {
	return JSON.parse(await fs.readFile(file, "utf8"));
}

t.test("readPackageJson()", async t1 => {
	t1.test("parses package.json in the directory", async t2 => {
		const dir = t2.testdir({ "package.json": '{ "name": "a" }' });
		t2.strictSame(await lib.readPackageJson(dir, false), { name: "a" });
	});
	t1.test("returns undefined when there is none", async t2 => {
		const dir = t2.testdir({});
		t2.equal(await lib.readPackageJson(dir, false), undefined);
		t2.equal(await lib.readPackageJson(path.join(dir, "missing"), true), undefined);
	});
	t1.test("returns undefined for invalid JSON when tolerant", async t2 => {
		const dir = t2.testdir({ "package.json": '{ "name": "a' });
		t2.equal(await lib.readPackageJson(dir, true), undefined);
	});
	t1.test("throws on invalid JSON when not tolerant", async t2 => {
		const dir = t2.testdir({ "package.json": '{ "name": "a' });
		await t2.rejects(lib.readPackageJson(dir, false), { name: "SyntaxError" });
	});
});

t.test("installedDependencies()", async t1 => {
	t1.test("merges dependencies and optionalDependencies", async t2 => {
		t2.strictSame(lib.installedDependencies({
			dependencies: { a: "1", b: "2" },
			optionalDependencies: { b: "file:b", c: "3" },
			devDependencies: { d: "4" },
		}), { a: "1", b: "file:b", c: "3" });
	});
	t1.test("returns nothing for missing fields", async t2 => {
		t2.strictSame(lib.installedDependencies(undefined), {});
		t2.strictSame(lib.installedDependencies({}), {});
	});
});

t.test("isRegistrySpec()", async t1 => {
	t1.test("accepts versions, ranges and tags", async t2 => {
		for (const spec of ["1.0.0", "^1.0.0", "~1.2", ">=1 <2", "*", "", "latest", "1.x || 2.x"]) {
			t2.equal(lib.isRegistrySpec(spec), true, spec);
		}
	});
	t1.test("rejects paths, git, urls, tarballs and aliases", async t2 => {
		for (const spec of [
			"file:../a", "link:a", "workspace:*", "npm:real@1", "github:user/repo", "user/repo",
			"git+https://example.com/a.git", "https://example.com/a.tgz", "./a", "../a", ".", "a\\b",
			"plugin-x-1.0.0.tgz", "plugin-x.tar.gz", "plugin-x.TAR", "plugin.tgz",
		]) {
			t2.equal(lib.isRegistrySpec(spec), false, spec);
		}
	});
	t1.test("rejects values that are not strings", async t2 => {
		for (const spec of [undefined, null, 1, {}, ["1.0.0"]]) {
			t2.equal(lib.isRegistrySpec(spec), false, String(spec));
		}
	});
});

t.test("realDir()", async t1 => {
	t1.test("follows symlinks", async t2 => {
		const dir = t2.testdir({ real: {}, link: t2.fixture("symlink", "real") });
		t2.equal(await lib.realDir(path.join(dir, "link")), await fs.realpath(path.join(dir, "real")));
	});
	t1.test("resolves paths that do not exist", async t2 => {
		const dir = t2.testdir({});
		t2.equal(await lib.realDir(path.join(dir, "gone", "..", "x")), path.join(await fs.realpath(dir), "x"));
		t2.equal(await lib.realDir("relative/gone"), path.resolve("relative/gone"));
	});
});

t.test("resolvePackagePath()", async t1 => {
	t1.test("returns the directory of an installed package", async t2 => {
		const dir = t2.testdir({ node_modules: { a: pkg("a"), "@s": { b: pkg("@s/b") } } });
		t2.equal(lib.resolvePackagePath("a", dir, false), path.join(dir, "node_modules", "a"));
		t2.equal(lib.resolvePackagePath("@s/b", dir, false), path.join(dir, "node_modules", "@s", "b"));
	});
	t1.test("resolves from parent directories", async t2 => {
		const dir = t2.testdir({ node_modules: { a: pkg("a") }, sub: { deeper: {} } });
		t2.equal(
			lib.resolvePackagePath("a", path.join(dir, "sub", "deeper"), false),
			path.join(dir, "node_modules", "a"),
		);
	});
	t1.test("returns undefined for a missing package", async t2 => {
		const dir = t2.testdir({});
		t2.equal(lib.resolvePackagePath("clusterio-test-missing-package", dir, false), undefined);
	});
	t1.test("returns undefined for a package that does not export package.json", async t2 => {
		const dir = t2.testdir({ node_modules: { a: pkg("a", { fields: { exports: { ".": "./index.js" } } }) } });
		t2.equal(lib.resolvePackagePath("a", dir, false), undefined);
	});
	t1.test("throws for a malformed package.json unless tolerant", async t2 => {
		const dir = t2.testdir({ node_modules: { a: { "package.json": '{ "name": "a' } } });
		t2.throws(() => lib.resolvePackagePath("a", dir, false), { code: "ERR_INVALID_PACKAGE_CONFIG" });
		t2.equal(lib.resolvePackagePath("a", dir, true), undefined);
	});
});

t.test("discoverNpmPluginPackages()", async t1 => {
	t1.test("finds plugins and their plugin dependencies", async t2 => {
		const dir = cwdFixture(t2, {
			node_modules: {
				"plugin-a": pkg("plugin-a", { dependencies: { "plugin-b": "^1.0.0", "not-plugin": "^1.0.0" } }),
				"plugin-b": pkg("plugin-b", { dependencies: { "plugin-a": "^1.0.0" } }),
				"not-plugin": notPlugin("not-plugin", { "plugin-hidden": "^1.0.0" }),
				"plugin-hidden": pkg("plugin-hidden"),
			},
		});
		const result = await lib.discoverNpmPluginPackages({
			"plugin-a": "^1.0.0", "not-plugin": "^1.0.0", "missing": "^1.0.0",
		});
		t2.strictSame(result.plugins.map(p => [p.packageName, p.packageVersion, p.packagePath]), [
			["plugin-a", "^1.0.0", path.join(dir, "node_modules", "plugin-a")],
			["plugin-b", "^1.0.0", path.join(dir, "node_modules", "plugin-b")],
		]);
		t2.equal(result.plugins[0].packageJson.name, "plugin-a");
		t2.strictSame(result.nonPluginRoots, [{ packageName: "not-plugin", packageVersion: "^1.0.0" }]);
		t2.equal(result.nonRegistryDirs.size, 0);
	});
	t1.test("records directories installed from somewhere other than the registry", async t2 => {
		const dir = cwdFixture(t2, {
			node_modules: {
				"plugin-a": pkg("plugin-a", { dependencies: { "plugin-b": "github:user/b" } }),
				"plugin-b": pkg("plugin-b"),
				"plugin-c": pkg("plugin-c", { dependencies: { "plugin-a": "file:../a" } }),
			},
		});
		const result = await lib.discoverNpmPluginPackages({ "plugin-a": "^1.0.0", "plugin-c": "^1.0.0" });
		const real = await fs.realpath(path.join(dir, "node_modules"));
		t2.strictSame([...result.nonRegistryDirs].sort(), [path.join(real, "plugin-a"), path.join(real, "plugin-b")]);
		t2.equal(result.plugins.length, 3, "visited packages are not added again");
	});
	t1.test("throws on a malformed package.json unless tolerant", async t2 => {
		cwdFixture(t2, {
			node_modules: {
				"plugin-a": pkg("plugin-a"),
				"plugin-broken": { "package.json": '{ "name": "plugin-bro', "index.js": "" },
			},
		});
		const dependencies = { "plugin-broken": "^1.0.0", "plugin-a": "^1.0.0" };
		await t2.rejects(lib.discoverNpmPluginPackages(dependencies), { code: "ERR_INVALID_PACKAGE_CONFIG" });
		const result = await lib.discoverNpmPluginPackages(dependencies, true);
		t2.strictSame(result.plugins.map(p => p.packageName), ["plugin-a"]);
		t2.strictSame(result.nonPluginRoots, []);
	});
	t1.test("treats a package.json without the keyword as not a plugin", async t2 => {
		cwdFixture(t2, {
			node_modules: {
				a: { "package.json": '{ "name": "a" }' },
				b: { "package.json": '{ "name": "b", "keywords": ["clusterio"] }' },
			},
		});
		const result = await lib.discoverNpmPluginPackages({ a: "1", b: "1" });
		t2.strictSame(result.plugins, []);
		t2.equal(result.nonPluginRoots.length, 2);
	});
	t1.test("treats a keywords string that contains the keyword as not a plugin", async t2 => {
		cwdFixture(t2, {
			node_modules: { b: { "package.json": '{ "name": "b", "keywords": "not-a-clusterio-plugin" }' } },
		});
		const result = await lib.discoverNpmPluginPackages({ b: "1" });
		t2.strictSame(result.plugins, []);
	});
});

t.test("findNonRegistryDirs()", async t1 => {
	t1.test("finds plugins installed from a path, git or url", async t2 => {
		const dir = cwdFixture(t2, {
			"package.json": rootPackage({ "plugin-a": "github:user/plugin-a", "plugin-b": "^1.0.0" }),
			node_modules: { "plugin-a": pkg("plugin-a"), "plugin-b": pkg("plugin-b") },
		});
		const pluginA = await fs.realpath(path.join(dir, "node_modules", "plugin-a"));
		t2.strictSame([...await lib.findNonRegistryDirs()], [pluginA]);
	});
	t1.test("returns nothing without a root package.json", async t2 => {
		cwdFixture(t2, {});
		t2.equal((await lib.findNonRegistryDirs()).size, 0);
	});
});

t.test("isNonRegistryPackage()", async t1 => {
	const fixture = () => ({
		"package.json": rootPackage(
			{ "plugin-a": "^1.0.0", "plugin-path": "file:../somewhere" },
			{ optionalDependencies: { "plugin-opt": "https://example.com/x.tgz" } },
		),
		node_modules: {
			"plugin-a": pkg("plugin-a", { dependencies: { "plugin-b": "github:user/plugin-b" } }),
			"plugin-b": pkg("plugin-b"),
			"plugin-c": pkg("plugin-c"),
		},
	});
	t1.test("is true for root dependencies not from the registry", async t2 => {
		cwdFixture(t2, fixture());
		t2.equal(await lib.isNonRegistryPackage("plugin-path"), true, "even when not installed");
		t2.equal(await lib.isNonRegistryPackage("plugin-opt"), true);
	});
	t1.test("is true for packages another plugin installs from elsewhere", async t2 => {
		cwdFixture(t2, fixture());
		t2.equal(await lib.isNonRegistryPackage("plugin-b"), true);
	});
	t1.test("is false for registry packages", async t2 => {
		cwdFixture(t2, fixture());
		t2.equal(await lib.isNonRegistryPackage("plugin-a"), false);
		t2.equal(await lib.isNonRegistryPackage("plugin-c"), false, "installed but not a dependency");
	});
	t1.test("is false for packages that are not installed", async t2 => {
		cwdFixture(t2, fixture());
		t2.equal(await lib.isNonRegistryPackage("plugin-missing"), false);
	});
});

t.test("loadPluginList()", async t1 => {
	t1.test("local plugins", async t2 => {
		t2.test("discovers plugins in plugins/ and external_plugins/", async t3 => {
			const dir = cwdFixture(t3, {
				plugins: { local_plugin: pkg("local", { pluginName: "local" }) },
				external_plugins: { external_plugin: pkg("external") },
			});
			const logs = captureLogs(t3);
			const listPath = path.join(dir, "plugin-list.json");
			const list = await lib.loadPluginList(listPath);
			t3.strictSame([...list], [
				["local_plugin", path.join(dir, "plugins", "local_plugin")],
				["external_plugin", path.join(dir, "external_plugins", "external_plugin")],
			]);
			t3.strictSame(await readList(listPath), [...list], "writes the list");
			t3.strictSame(logs.infos, [
				`No existing plugin list found at ${listPath}`,
				"Added local_plugin from plugins",
				"Added external_plugin from external_plugins",
			]);
		});
		t2.test("scans folders one level down for monorepos", async t3 => {
			const dir = cwdFixture(t3, {
				external_plugins: {
					monorepo: {
						"package.json": "{}",
						inner: pkg("inner"),
						deeper: { deepest: pkg("deepest") },
					},
					node_modules: { ignored: pkg("ignored") },
					".git": { ignored: pkg("ignored") },
					"README.md": "not a directory",
				},
			});
			const logs = captureLogs(t3);
			const list = await lib.loadPluginList(path.join(dir, "list.json"));
			t3.strictSame([...list], [["inner", path.join(dir, "external_plugins", "monorepo", "inner")]]);
			t3.strictSame(logs.warnings, [
				"Possible monorepo detected, scanning " +
				`${path.join("external_plugins", "monorepo")} for clusterio-plugins`,
			]);
		});
		t2.test("keeps plugins already in the list", async t3 => {
			const dir = cwdFixture(t3, {
				plugins: { same: pkg("same"), other: pkg("other") },
				"list.json": "",
			});
			const listPath = path.join(dir, "list.json");
			const entries = [["same", path.join(dir, "plugins", "same")], ["other", "/elsewhere/other"]];
			await fs.writeFile(listPath, JSON.stringify(entries));
			const logs = captureLogs(t3);
			const list = await lib.loadPluginList(listPath);
			t3.strictSame([...list], entries);
			t3.strictSame(logs.warnings, [
				"other is already in the plugin list, but with a different path - using /elsewhere/other",
			]);
			t3.equal(await fs.readFile(listPath, "utf8"), JSON.stringify(entries), "list is not rewritten");
		});
		t2.test("are not searched with findLocal false", async t3 => {
			const dir = cwdFixture(t3, { plugins: { local: pkg("local") } });
			captureLogs(t3);
			const listPath = path.join(dir, "list.json");
			t3.strictSame([...await lib.loadPluginList(listPath, false)], []);
			await t3.rejects(fs.access(listPath), { code: "ENOENT" });
		});
		t2.test("rejects when plugins is not a directory", async t3 => {
			const dir = cwdFixture(t3, { plugins: "file" });
			captureLogs(t3);
			await t3.rejects(lib.loadPluginList(path.join(dir, "list.json")), { code: "ENOTDIR" });
		});
	});

	t1.test("npm plugins", async t2 => {
		const npmFixture = () => ({
			"package.json": rootPackage({
				"plugin-npm": "^1.0.0",
				"not-a-plugin": "^1.0.0",
				"@clusterio/controller": "^2.0.0",
				"plugin-aliased": "npm:real-plugin@^0.0.1",
				"plugin-deep": "^0.0.1",
			}),
			node_modules: {
				"plugin-npm": pkg("plugin-npm", { pluginName: "npm", dependencies: { "plugin-transitive": "^1.0.0" } }),
				"plugin-transitive": {
					...pkg("plugin-transitive", { pluginName: "transitive" }),
					node_modules: { "plugin-nested": pkg("plugin-nested", { pluginName: "nested" }) },
				},
				"plugin-aliased": pkg("real-plugin", { pluginName: "aliased" }),
				"plugin-deep": {
					...pkg("plugin-deep", { pluginName: "unused", fields: { main: "./dist/index.js" } }),
					dist: { "index.js": "export const plugin = { name: \"deep\" };" },
				},
				"not-a-plugin": notPlugin("not-a-plugin", { "plugin-hidden": "^0.0.1" }),
				"plugin-hidden": pkg("plugin-hidden", { pluginName: "hidden" }),
				"@clusterio": { controller: notPlugin("@clusterio/controller") },
			},
		});

		t2.test("discovers root and transitive plugins by plugin name", async t3 => {
			const dir = cwdFixture(t3, npmFixture());
			const logs = captureLogs(t3);
			const listPath = path.join(dir, "list.json");
			const list = await lib.loadPluginList(listPath, false);
			t3.strictSame([...list], [
				["npm", "plugin-npm"],
				["aliased", "plugin-aliased"],
				["deep", "plugin-deep"],
				["transitive", "plugin-transitive"],
			]);
			t3.strictSame(await readList(listPath), [...list]);
			t3.strictSame(
				logs.warnings,
				["not-a-plugin@^1.0.0 is not a clusterio-plugin"],
				"core packages are not warned",
			);
			t3.ok(logs.infos.includes("Added npm from node modules"));
		});
		t2.test("does not change a list that already has them", async t3 => {
			const dir = cwdFixture(t3, npmFixture());
			const entries = [
				["npm", "plugin-npm"],
				["aliased", "plugin-aliased"],
				["deep", "plugin-deep"],
				["transitive", "plugin-transitive"],
			];
			const listPath = path.join(dir, "list.json");
			await fs.writeFile(listPath, JSON.stringify(entries));
			const logs = captureLogs(t3);
			const skipped = new Map<string, string>();
			t3.strictSame([...await lib.loadPluginList(listPath, false, skipped)], entries);
			t3.equal(skipped.size, 0);
			t3.equal(await fs.readFile(listPath, "utf8"), JSON.stringify(entries));
			t3.strictSame(logs.infos, [`Loaded 4 plugins from ${listPath}`]);
		});
		t2.test("records npm plugins skipped because their name is taken", async t3 => {
			const dir = cwdFixture(t3, { ...npmFixture(), plugins: { local: pkg("local", { pluginName: "npm" }) } });
			const localPath = path.join(dir, "plugins", "local");
			const listPath = path.join(dir, "list.json");
			await fs.writeFile(listPath, JSON.stringify([["npm", localPath], ["deep", "plugin-transitive"]]));
			const logs = captureLogs(t3);
			const skipped = new Map<string, string>();
			const list = await lib.loadPluginList(listPath, false, skipped);
			t3.equal(list.get("npm"), localPath);
			t3.equal(list.get("deep"), "plugin-transitive", "a listed package name that exists is kept");
			const real = await fs.realpath(path.join(dir, "node_modules"));
			t3.strictSame([...skipped], [
				["npm", path.join(real, "plugin-npm")],
				["deep", path.join(real, "plugin-deep")],
			]);
			t3.ok(logs.warnings.includes(
				"npm provided by plugin-npm@^1.0.0 is already in the plugin list, " +
				`but with a different path - using ${localPath}`,
			));
		});
		t2.test("replaces list entries that no longer exist", async t3 => {
			const dir = cwdFixture(t3, npmFixture());
			const gone = path.join(dir, "plugins", "gone");
			const listPath = path.join(dir, "list.json");
			await fs.writeFile(listPath, JSON.stringify([["npm", gone], ["aliased", "plugin-gone"]]));
			const logs = captureLogs(t3);
			const skipped = new Map<string, string>();
			const list = await lib.loadPluginList(listPath, false, skipped);
			t3.equal(list.get("npm"), "plugin-npm");
			t3.equal(list.get("aliased"), "plugin-aliased");
			t3.equal(skipped.size, 0);
			t3.equal(new Map(await readList(listPath)).get("npm"), "plugin-npm");
			t3.strictSame(logs.warnings, [
				`npm at ${gone} no longer exists, using plugin-npm`,
				"aliased at plugin-gone no longer exists, using plugin-aliased",
				"not-a-plugin@^1.0.0 is not a clusterio-plugin",
			]);
		});
		t2.test("does nothing without a root package.json", async t3 => {
			const dir = cwdFixture(t3, { node_modules: { "plugin-a": pkg("plugin-a") } });
			captureLogs(t3);
			t3.strictSame([...await lib.loadPluginList(path.join(dir, "list.json"), false)], []);
		});
		t2.test("handles a root package.json without dependencies", async t3 => {
			const dir = cwdFixture(t3, { "package.json": '{ "name": "root" }' });
			captureLogs(t3);
			t3.strictSame([...await lib.loadPluginList(path.join(dir, "list.json"), false)], []);
		});
		t2.test("rejects a malformed root package.json", async t3 => {
			const dir = cwdFixture(t3, { "package.json": '{ "name": "ro' });
			captureLogs(t3);
			await t3.rejects(lib.loadPluginList(path.join(dir, "list.json"), false), { name: "SyntaxError" });
		});
		t2.test("rejects a plugin package that does not export a plugin", async t3 => {
			const dir = cwdFixture(t3, {
				"package.json": rootPackage({ "plugin-a": "^1.0.0" }),
				node_modules: { "plugin-a": { ...pkg("plugin-a"), "index.js": "export const other = 1;" } },
			});
			captureLogs(t3);
			await t3.rejects(lib.loadPluginList(path.join(dir, "list.json"), false), { name: "TypeError" });
		});
	});

	t1.test("plugin list file", async t2 => {
		t2.test("loads an existing list", async t3 => {
			const dir = cwdFixture(t3, { "list.json": JSON.stringify([["test", "/test/path"]]) });
			const logs = captureLogs(t3);
			const listPath = path.join(dir, "list.json");
			t3.strictSame([...await lib.loadPluginList(listPath, false)], [["test", "/test/path"]]);
			t3.strictSame(logs.infos, [`Loaded 1 plugins from ${listPath}`]);
		});
		t2.test("rejects an invalid list", async t3 => {
			const dir = cwdFixture(t3, { "list.json": "[[" });
			captureLogs(t3);
			await t3.rejects(lib.loadPluginList(path.join(dir, "list.json"), false), { name: "SyntaxError" });
		});
		t2.test("rejects a list that can't be read", async t3 => {
			const dir = cwdFixture(t3, { "list.json": {} });
			captureLogs(t3);
			await t3.rejects(lib.loadPluginList(path.join(dir, "list.json"), false), { code: "EISDIR" });
		});
	});
});
