import assert from "node:assert/strict";
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
		it("rejects while another operation is in progress", async function() {
			const audit = lib.logger.audit;
			let nested;
			lib.logger.audit = function() {
				lib.logger.audit = audit;
				nested = lib.installPackage("bar");
			};
			try {
				await lib.installPackage("foo");
			} finally {
				lib.logger.audit = audit;
			}
			await assert.rejects(nested, /Another package operation is already in progress/);
			// The lock is released once the operation finishes
			await lib.installPackage("foo");
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

	describe("fetchLatestVersions", function() {
		const _fetch = global.fetch;
		let calls;
		beforeEach(function() {
			calls = [];
			global.fetch = async function(url) {
				calls.push(url);
				if (url.includes("broken")) {
					throw new Error("network down");
				}
				if (url.includes("missing")) {
					return { ok: false };
				}
				return { ok: true, json: async () => ({ version: "1.2.3" }) };
			};
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("returns the latest version of found packages", async function() {
			const versions = await lib.fetchLatestVersions(["latest-a", "@scope/latest-b", "missing-a", "broken-a"]);
			assert.deepEqual(versions, { "latest-a": "1.2.3", "@scope/latest-b": "1.2.3" });
			assert.ok(calls.includes("https://registry.npmjs.com/@scope/latest-b/latest"));
		});
		it("caches lookups", async function() {
			await lib.fetchLatestVersions(["cached-a", "missing-b"]);
			calls = [];
			assert.deepEqual(await lib.fetchLatestVersions(["cached-a", "missing-b"]), { "cached-a": "1.2.3" });
			assert.deepEqual(calls, []);
		});
		it("retries packages the registry couldn't be reached for", async function() {
			await lib.fetchLatestVersions(["broken-b"]);
			calls = [];
			await lib.fetchLatestVersions(["broken-b"]);
			assert.equal(calls.length, 1);
		});
		it("rejects invalid names", async function() {
			await assert.rejects(lib.fetchLatestVersions(["foo@1.0.0"]), /Invalid plugin name/);
			await assert.rejects(lib.fetchLatestVersions(["foo bar"]), /Invalid plugin name/);
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

			await lib.handlePluginInstall("foo@1.2.3");
			assert.equal(calledWith, "https://registry.npmjs.com/foo/1.2.3");
			await lib.handlePluginInstall("@scope/foo@1.0.0-alpha.1");
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
