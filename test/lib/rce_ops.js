"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

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

	describe("handlePluginUpdate", function() {
		it("runs", async function() {
			await lib.handlePluginUpdate("foo", [{ npmPackage: "foo" }]);
		});
		it("rejects when plugin not installed", async function() {
			await assert.rejects(
				lib.handlePluginUpdate("foo", []),
				/Plugin foo is not installed on this machine/
			);
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
