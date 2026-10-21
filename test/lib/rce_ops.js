import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import * as lib from "@clusterio/lib";
import "../setup_logging.js";

describe("rce_ops", function() {
	describe("updatePackage", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.updatePackage("foo");
		});
	});

	describe("installPackage", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.installPackage("foo");
		});
	});

	describe("package operations", function() {
		const lockPath = "npm-operation.lock";
		const inProgress = /Another package operation is already in progress/;
		const audit = lib.logger.audit;
		const recoveryPath = `${lockPath}.recovery`;
		const writeFile = fs.writeFile;
		afterEach(async function() {
			lib.logger.audit = audit;
			fs.writeFile = writeFile;
			await fs.rm(lockPath, { force: true });
			await fs.rm(recoveryPath, { force: true });
		});

		it("rejects while another operation is in progress", async function() {
			let nested;
			lib.logger.audit = function() {
				lib.logger.audit = audit;
				nested = lib.installPackage("bar");
			};
			await lib.installPackage("foo");
			await assert.rejects(nested, inProgress);
			// The lock is released once the operation finishes
			await lib.installPackage("foo");
			await assert.rejects(fs.access(lockPath));
		});
		it("runs only one of several operations started together", async function() {
			const results = await Promise.allSettled([
				lib.installPackage("foo"), lib.updatePackage("bar"), lib.installPackage("baz"),
			]);
			assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected", "rejected"]);
			for (const result of results.slice(1)) {
				assert.match(result.reason.message, inProgress);
			}
		});
		it("holds the lock file while the operation runs", async function() {
			let lockContent;
			lib.logger.audit = function() {
				// eslint-disable-next-line node/no-sync
				lockContent = fsSync.readFileSync(lockPath, "utf8");
			};
			await lib.installPackage("foo");
			assert.equal(lockContent, `${process.pid} ${performance.timeOrigin}\n`);
			await assert.rejects(fs.access(lockPath));
		});
		it("releases the lock when the operation fails", async function() {
			lib.logger.audit = function() {
				throw new Error("operation failed");
			};
			await assert.rejects(lib.installPackage("foo"), /operation failed/);
			lib.logger.audit = audit;
			await assert.rejects(fs.access(lockPath));
			await lib.installPackage("foo");
		});
		it("leaves a lock it does not own in place", async function() {
			lib.logger.audit = function() {
				// eslint-disable-next-line node/no-sync
				fsSync.writeFileSync(lockPath, `${process.ppid}\n`);
			};
			await lib.installPackage("foo");
			assert.equal(await fs.readFile(lockPath, "utf8"), `${process.ppid}\n`);
		});
		it("rejects while another process holds the lock", async function() {
			// A standalone controller and host share the installation directory
			await fs.writeFile(lockPath, `${process.ppid}\n`);
			await assert.rejects(lib.installPackage("foo"), inProgress);
			assert.equal(await fs.readFile(lockPath, "utf8"), `${process.ppid}\n`);
		});
		it("ignores a lock left by a process that exited", async function() {
			await fs.writeFile(lockPath, "999999999\n");
			await lib.installPackage("foo");
			await assert.rejects(fs.access(lockPath));
			assert.deepEqual((await fs.readdir(".")).filter(name => name.startsWith(`${lockPath}.`)), []);
		});
		it("ignores a lock left by an earlier process with the same pid", async function() {
			for (const content of [`${process.pid}\n`, `${process.pid} 1234.5\n`]) {
				await fs.writeFile(lockPath, content);
				await lib.installPackage("foo");
				await assert.rejects(fs.access(lockPath));
			}
		});
		it("rejects while another copy of lib in this process holds the lock", async function() {
			const rceOpsUrl = new URL("../../packages/lib/dist/node/src/rce_ops.js", import.meta.url);
			const otherCopy = await import(`${rceOpsUrl.href}?copy`);
			let nested;
			lib.logger.audit = function() {
				lib.logger.audit = audit;
				nested = otherCopy.installPackage("bar");
			};
			await lib.installPackage("foo");
			await assert.rejects(nested, inProgress);
		});
		it("reports whether an operation is running", async function() {
			assert.equal(await lib.packageOperationRunning(), false);
			let running;
			lib.logger.audit = function() {
				lib.logger.audit = audit;
				running = lib.packageOperationRunning();
			};
			await lib.installPackage("foo");
			assert.equal(await running, true);
			assert.equal(await lib.packageOperationRunning(), false);
			await fs.writeFile(lockPath, `${process.ppid}\n`);
			assert.equal(await lib.packageOperationRunning(), true);
			await fs.writeFile(lockPath, "999999999\n");
			assert.equal(await lib.packageOperationRunning(), false);
		});
		it("names the process holding the lock", async function() {
			await fs.writeFile(lockPath, `${process.ppid} 1234.5\n`);
			await assert.rejects(lib.installPackage("foo"), new RegExp(`held by process ${process.ppid}\\)`));
		});
		it("respects a lock that is still being written", async function() {
			await fs.writeFile(lockPath, "");
			await assert.rejects(lib.installPackage("foo"), inProgress);
		});
		// Runs takeOver right before this process starts clearing the stale lock, as another process could
		function beforeRecovery(takeOver) {
			fs.writeFile = async function(...args) {
				if (String(args[0]).endsWith(recoveryPath)) {
					fs.writeFile = writeFile;
					await takeOver();
				}
				return writeFile(...args);
			};
		}
		it("leaves a lock taken after the stale check in place", async function() {
			await fs.writeFile(lockPath, "999999999\n");
			beforeRecovery(async () => {
				await fs.rm(lockPath);
				await fs.writeFile(lockPath, `${process.ppid}\n`);
			});
			await assert.rejects(lib.installPackage("foo"), inProgress);
			assert.equal(await fs.readFile(lockPath, "utf8"), `${process.ppid}\n`);
			await assert.rejects(fs.access(recoveryPath));
		});
		it("leaves a new empty lock in place of an old empty lock", async function() {
			await fs.writeFile(lockPath, "");
			const old = new Date(Date.now() - 60e3);
			await fs.utimes(lockPath, old, old);
			// Another process clears it and creates a new lock that it hasn't written its pid to yet
			beforeRecovery(async () => {
				await fs.rm(lockPath);
				await fs.writeFile(lockPath, "");
			});
			await assert.rejects(lib.installPackage("foo"), inProgress);
			assert.equal(await fs.readFile(lockPath, "utf8"), "");
			assert((await fs.stat(lockPath)).mtimeMs > old.getTime() + 30e3);
		});
		it("leaves a stale lock alone while another process clears it", async function() {
			await fs.writeFile(lockPath, "999999999\n");
			await fs.writeFile(recoveryPath, `${process.ppid}\n`);
			await assert.rejects(lib.installPackage("foo"), inProgress);
			assert.equal(await fs.readFile(lockPath, "utf8"), "999999999\n");
			assert.equal(await fs.readFile(recoveryPath, "utf8"), `${process.ppid}\n`);
		});
		it("reports an interrupted recovery", async function() {
			await fs.writeFile(lockPath, "999999999\n");
			await fs.writeFile(recoveryPath, "999999999\n");
			await assert.rejects(lib.installPackage("foo"), /remove .*npm-operation\.lock\.recovery/);
		});
		it("ignores an unreadable lock that is old", async function() {
			await fs.writeFile(lockPath, "");
			const old = new Date(Date.now() - 60e3);
			await fs.utimes(lockPath, old, old);
			await lib.installPackage("foo");
			await assert.rejects(fs.access(lockPath));
		});
	});

	describe("handlePluginUpdate", function() {
		it("runs", async function() {
			await lib.handlePluginUpdate("foo", [{ npmPackage: "foo" }]);
		});
		it("rejects when plugin not installed", async function() {
			await assert.rejects(
				lib.handlePluginUpdate("foo", []),
				/Plugin foo is not installed on this machine/
			);
			await assert.rejects(
				lib.handlePluginUpdate("foo@1.2.3", []),
				/Plugin foo is not installed on this machine/
			);
		});
		it("updates to a pinned version", async function() {
			const _fetch = global.fetch;
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};
			try {
				await lib.handlePluginUpdate("@scope/foo@1.2.3", [{ npmPackage: "@scope/foo" }]);
				assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo/1.2.3");
				global.fetch = function() { return { ok: false }; };
				await assert.rejects(
					lib.handlePluginUpdate("foo@9.9.9", [{ npmPackage: "foo" }]),
					/Unknown plugin: foo@9.9.9/,
				);
			} finally {
				global.fetch = _fetch;
			}
		});
	});

	describe("installing over a dependency not from the registry", function() {
		const cwd = process.cwd();
		const dir = path.resolve("temp", "test", "rce_ops_local_dependency");
		const _fetch = global.fetch;
		before(async function() {
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: {
				"linked": "file:../linked",
				"aliased": "npm:other@^1.0.0",
				"from-git": "github:user/from-git",
				"published": "^1.0.0",
				"optional": "^1.0.0",
			}, optionalDependencies: {
				"optional": "github:user/optional",
			} }));
			process.chdir(dir);
			global.fetch = function() { return { ok: true }; };
		});
		after(function() {
			process.chdir(cwd);
			global.fetch = _fetch;
		});

		it("rejects installs and pinned updates", async function() {
			for (const name of ["linked", "aliased", "from-git", "optional"]) {
				const error = new RegExp(`${name} is not installed from npm on this machine`);
				await assert.rejects(lib.handlePluginInstall(`${name}@2.0.0`), error);
				await assert.rejects(lib.handlePluginUpdate(`${name}@2.0.0`, [{ npmPackage: name }]), error);
			}
			await lib.handlePluginInstall("published@2.0.0");
			await lib.handlePluginUpdate("published@2.0.0", [{ npmPackage: "published" }]);
		});

		it("rejects pinned updates of a plugin another plugin installs from git", async function() {
			const modules = path.join(dir, "node_modules");
			const plugin = (name, dependencies) => fs.mkdir(path.join(modules, name), { recursive: true })
				.then(() => fs.writeFile(path.join(modules, name, "package.json"), JSON.stringify({
					name, version: "1.0.0", keywords: ["clusterio-plugin"], dependencies,
				})));
			await plugin("published", { child: "github:user/child" });
			await plugin("child", {});
			try {
				await assert.rejects(
					lib.handlePluginUpdate("child@2.0.0", [{ npmPackage: "child" }]),
					/child is not installed from npm on this machine/,
				);
			} finally {
				await fs.rm(modules, { recursive: true, force: true });
			}
		});

		it("rejects pinned updates of a plugin an optional dependency installs from git", async function() {
			const modules = path.join(dir, "node_modules");
			const plugin = (name, packageJson) => fs.mkdir(path.join(modules, name), { recursive: true })
				.then(() => fs.writeFile(path.join(modules, name, "package.json"), JSON.stringify({
					name, version: "1.0.0", keywords: ["clusterio-plugin"], ...packageJson,
				})));
			await plugin("published", {
				dependencies: { child: "^1.0.0" },
				optionalDependencies: { child: "github:user/child" },
			});
			await plugin("child", {});
			try {
				await assert.rejects(
					lib.handlePluginUpdate("child@2.0.0", [{ npmPackage: "child" }]),
					/child is not installed from npm on this machine/,
				);
			} finally {
				await fs.rm(modules, { recursive: true, force: true });
			}
		});

		it("checks the source again once it holds the lock", async function() {
			const packageJsonPath = path.join(dir, "package.json");
			const original = await fs.readFile(packageJsonPath, "utf8");
			// Another operation switches it to git while the registry is being checked
			global.fetch = async function() {
				const packageJson = JSON.parse(original);
				packageJson.dependencies.published = "github:user/published";
				await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
				return { ok: true };
			};
			try {
				const error = /published is not installed from npm on this machine/;
				await assert.rejects(lib.handlePluginInstall("published@2.0.0"), error);
				await fs.writeFile(packageJsonPath, original);
				await assert.rejects(lib.handlePluginUpdate("published@2.0.0", [{ npmPackage: "published" }]), error);
			} finally {
				global.fetch = function() { return { ok: true }; };
				await fs.writeFile(packageJsonPath, original);
			}
		});
	});

	describe("fetchLatestVersions", function() {
		const _fetch = global.fetch;
		let calls;
		let cache;
		beforeEach(function() {
			calls = [];
			cache = new Map();
			global.fetch = async function(url, options) {
				calls.push(url);
				assert.ok(options.signal, "lookups have a timeout");
				if (url.includes("broken")) {
					throw new Error("network down");
				}
				if (url.includes("missing")) {
					return { ok: false, status: 404 };
				}
				if (url.includes("limited")) {
					return { ok: false, status: 429 };
				}
				return { ok: true, json: async () => ({ version: "1.2.3" }) };
			};
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("returns the latest version of found packages", async function() {
			const versions = await lib.fetchLatestVersions(
				["latest-a", "@scope/latest-b", "missing-a", "broken-a"], cache,
			);
			assert.deepEqual(versions, { "latest-a": "1.2.3", "@scope/latest-b": "1.2.3" });
			assert.ok(calls.includes("https://registry.npmjs.com/@scope/latest-b/latest"));
		});
		it("caches lookups", async function() {
			await lib.fetchLatestVersions(["cached-a", "missing-b"], cache);
			calls = [];
			assert.deepEqual(await lib.fetchLatestVersions(["cached-a", "missing-b"], cache), { "cached-a": "1.2.3" });
			assert.deepEqual(calls, []);
		});
		it("retries packages the registry couldn't be reached for or refused", async function() {
			await lib.fetchLatestVersions(["broken-b", "limited-a"], cache);
			calls = [];
			await lib.fetchLatestVersions(["broken-b", "limited-a"], cache);
			assert.equal(calls.length, 2);
		});
		it("drops expired lookups and keeps the cache bounded", async function() {
			cache.set("expired", { version: "0.0.1", fetchedAt: Date.now() - 10 * 60e3 });
			await lib.fetchLatestVersions(["fresh"], cache);
			assert.equal(cache.has("expired"), false);
			for (let i = 0; i < 1000; i++) {
				cache.set(`filler-${i}`, { version: "1.0.0", fetchedAt: Date.now() });
			}
			await lib.fetchLatestVersions(["newest"], cache);
			assert.equal(cache.size, 1000);
			assert.equal(cache.get("newest").version, "1.2.3");
		});
		it("limits concurrent lookups", async function() {
			let active = 0;
			let maxActive = 0;
			global.fetch = async function() {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise(resolve => setImmediate(resolve));
				active -= 1;
				return { ok: true, json: async () => ({ version: "1.0.0" }) };
			};
			const names = Array.from({ length: 50 }, (_, i) => `package-${i}`);
			assert.equal(Object.keys(await lib.fetchLatestVersions(names, cache)).length, 50);
			assert.ok(maxActive <= 8, `${maxActive} concurrent lookups`);
		});
		it("rejects invalid names", async function() {
			await assert.rejects(lib.fetchLatestVersions(["foo@1.0.0"], cache), /Invalid plugin name/);
			await assert.rejects(lib.fetchLatestVersions(["foo bar"], cache), /Invalid plugin name/);
		});
	});

	describe("handleUpdateAll", function() {
		it("updates the core package and all npm plugins in one command", async function() {
			const _audit = lib.logger.audit;
			const messages = [];
			lib.logger.audit = (msg) => { messages.push(msg); };
			try {
				await lib.handleUpdateAll("core", [{ npmPackage: "foo" }, { name: "local" }, { npmPackage: "bar" }]);
			} finally {
				lib.logger.audit = _audit;
			}
			assert.deepEqual(messages, ["RCE | npm update --save core foo bar"]);
		});
	});

	describe("handlePluginInstall", function() {
		const _fetch = global.fetch;
		before(function() {
			global.fetch = function() { return { ok: false }; };
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("runs", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};

			await lib.handlePluginInstall("foo");
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});
		it("installs a pinned version", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};

			assert.equal(await lib.handlePluginInstall("foo@1.2.3"), "foo");
			assert.equal(calledWith, "https://registry.npmjs.com/foo/1.2.3");
			assert.equal(await lib.handlePluginInstall("@scope/foo@1.0.0-alpha.1"), "@scope/foo");
			assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo/1.0.0-alpha.1");
			await lib.handlePluginInstall("@scope/foo");
			assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo");
		});
		it("rejects unregistered versions", async function() {
			global.fetch = function() { return { ok: false }; };
			await assert.rejects(lib.handlePluginInstall("foo@9.9.9"), /Unknown plugin: foo@9.9.9/);
		});
		it("rejects invalid versions", async function() {
			await assert.rejects(lib.handlePluginInstall("foo@"), /Invalid plugin version: /);
			await assert.rejects(lib.handlePluginInstall("foo@-1"), /Invalid plugin version: -1/);
		});
		it("rejects when name too long", async function() {
			const pluginName = "a".repeat(215);
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` }
			);
		});
		it("rejects specs npm would read as a path, repository or option", async function() {
			let fetched = false;
			global.fetch = function() {
				fetched = true;
				return { ok: true };
			};
			for (const spec of [
				".", "..", "./foo", "../foo", "foo/latest", "@clusterio/lib/latest", "-/ping", "-foo", ".foo",
				"_foo", "@scope", "@scope/", "@/foo", "@scope/foo/bar", "foo/bar@1.0.0", "github:foo/bar",
			]) {
				await assert.rejects(lib.handlePluginInstall(spec), /Invalid plugin name/, spec);
			}
			assert.equal(fetched, false);
		});
		it("rejects when invalid symbol present", async function() {
			const pluginName = "?";
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` },
			);
		});
		it("rejects unregistered packages", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: false };
			};

			await assert.rejects(lib.handlePluginInstall("foo"), /Unknown plugin: foo/);
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});
	});

	describe("searchPlugins", function() {
		const _fetch = global.fetch;
		const registryResponse = {
			total: 1,
			objects: [{
				package: {
					name: "@clusterio/plugin-foo",
					version: "1.0.0",
					description: "Foo",
					date: "2026-01-01T00:00:00.000Z",
					publisher: { username: "bar" },
					links: {
						npm: "https://www.npmjs.com/package/@clusterio/plugin-foo",
						homepage: "https://example.com",
						repository: "https://github.com/example/foo",
					},
				},
			}],
		};
		after(function() {
			global.fetch = _fetch;
		});

		it("queries the registry with the plugin keyword", async function() {
			let calledWith;
			global.fetch = function(url) {
				calledWith = new URL(url);
				return { ok: true, json: async () => registryResponse };
			};

			const response = await lib.searchPlugins("foo", 2, 10);
			assert.equal(calledWith.origin + calledWith.pathname, "https://registry.npmjs.com/-/v1/search");
			assert.equal(calledWith.searchParams.get("text"), "keywords:clusterio-plugin foo");
			assert.equal(calledWith.searchParams.get("size"), "10");
			assert.equal(calledWith.searchParams.get("from"), "10");
			assert.deepEqual(response, new lib.PluginSearchRequest.Response(1, [
				new lib.PluginSearchResult(
					"@clusterio/plugin-foo", "1.0.0", "Foo", "bar", "2026-01-01T00:00:00.000Z",
					"https://example.com", "https://github.com/example/foo",
					"https://www.npmjs.com/package/@clusterio/plugin-foo",
				),
			]));
		});
		it("omits the query when empty", async function() {
			let calledWith;
			global.fetch = function(url) {
				calledWith = new URL(url);
				return { ok: true, json: async () => ({ total: 0, objects: [] }) };
			};

			await lib.searchPlugins("", 1, 20);
			assert.equal(calledWith.searchParams.get("text"), "keywords:clusterio-plugin");
			assert.equal(calledWith.searchParams.get("from"), "0");
		});
		it("drops optional fields the registry sends as null", async function() {
			global.fetch = function() {
				return { ok: true, json: async () => ({ total: 1, objects: [{ package: {
					name: "foo", version: "1.0.0", description: null, date: null,
					publisher: { username: null }, links: { npm: null, homepage: null, repository: null },
				} }] }) };
			};
			const response = await lib.searchPlugins("", 1, 20);
			assert.deepEqual(response, new lib.PluginSearchRequest.Response(1, [
				new lib.PluginSearchResult("foo", "1.0.0"),
			]));
			const validate = lib.compile(lib.PluginSearchRequest.Response.jsonSchema);
			assert.ok(validate(JSON.parse(JSON.stringify(response))), JSON.stringify(validate.errors));
		});
		it("handles missing optional fields", async function() {
			global.fetch = function() {
				return { ok: true, json: async () => ({ total: 1, objects: [{
					package: { name: "foo", version: "1.0.0" },
				}]}) };
			};

			const response = await lib.searchPlugins("", 1, 20);
			assert.deepEqual(response.results, [new lib.PluginSearchResult("foo", "1.0.0")]);
		});
		it("rejects invalid paging", async function() {
			await assert.rejects(lib.searchPlugins("", 0, 20), /Invalid page or page size/);
			await assert.rejects(lib.searchPlugins("", 1, 0), /Invalid page or page size/);
			await assert.rejects(lib.searchPlugins("", 1, 251), /Invalid page or page size/);
		});
		it("rejects overly long queries", async function() {
			await assert.rejects(lib.searchPlugins("a".repeat(215), 1, 20), /Search query too long/);
		});
		it("rejects when the registry errors", async function() {
			global.fetch = function() {
				return { ok: false, status: 503, statusText: "Service Unavailable" };
			};
			await assert.rejects(lib.searchPlugins("", 1, 20), /npm registry search failed: 503/);
		});
	});
});
