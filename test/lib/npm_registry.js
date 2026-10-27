import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import "../setup_logging.js";

describe("lib/npm_registry", function() {
	describe("fetchLatestVersions()", function() {
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

	describe("searchPlugins()", function() {
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
