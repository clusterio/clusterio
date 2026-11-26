import t from "tap";
import * as lib from "@clusterio/lib";

type FetchHandler = (url: string, init?: RequestInit) => Promise<Partial<Response>> | Partial<Response>;

// Replace fetch for the test, records the requested URLs as strings
function mockFetch(t1: any, handler: FetchHandler) {
	const urls: string[] = [];
	const inits: (RequestInit | undefined)[] = [];
	t1.intercept(globalThis, "fetch", {
		value: async (url: string | URL, init?: RequestInit) => {
			urls.push(String(url));
			inits.push(init);
			return handler(String(url), init);
		},
	});
	return { urls, inits };
}

function jsonResponse(json: unknown) {
	return { ok: true, status: 200, json: async () => json };
}

// Version 1.2.3 for every package except names containing broken, missing or limited
function registry(t1: any) {
	return mockFetch(t1, url => {
		if (url.includes("broken")) {
			throw new Error("network down");
		}
		if (url.includes("missing")) {
			return { ok: false, status: 404 };
		}
		if (url.includes("limited")) {
			return { ok: false, status: 429 };
		}
		return jsonResponse({ version: "1.2.3" });
	});
}

t.test("parsePackageSpec()", async t1 => {
	t1.test("parses a plain name", async t2 => {
		t2.strictSame(lib.parsePackageSpec("foo"), { name: "foo", version: undefined });
	});
	t1.test("parses a name with a version", async t2 => {
		t2.strictSame(lib.parsePackageSpec("foo@1.2.3"), { name: "foo", version: "1.2.3" });
	});
	t1.test("parses a scoped name", async t2 => {
		t2.strictSame(lib.parsePackageSpec("@scope/foo"), { name: "@scope/foo", version: undefined });
	});
	t1.test("parses a scoped name with a version or tag", async t2 => {
		t2.strictSame(
			lib.parsePackageSpec("@scope/foo@1.0.0-beta.1+b"),
			{ name: "@scope/foo", version: "1.0.0-beta.1+b" },
		);
		t2.strictSame(lib.parsePackageSpec("@scope/foo@latest"), { name: "@scope/foo", version: "latest" });
	});
	t1.test("accepts a name of 214 characters", async t2 => {
		const name = "a".repeat(214);
		t2.equal(lib.parsePackageSpec(name).name, name);
	});
	t1.test("rejects a name over 214 characters", async t2 => {
		const name = "a".repeat(215);
		t2.throws(() => lib.parsePackageSpec(name), new lib.ValidationError(`Invalid plugin name: ${name}`));
	});
	t1.test("rejects names npm reads as something else", async t2 => {
		for (const spec of [
			"", ".foo", "-foo", "../foo", "foo/bar", "@scope", "@/foo", "@scope/.foo", "foo bar",
			"git+https://x", "file:foo", "@", "@1.0.0",
		]) {
			t2.throws(() => lib.parsePackageSpec(spec), new lib.ValidationError(`Invalid plugin name: ${spec}`), spec);
		}
	});
	t1.test("rejects invalid versions", async t2 => {
		for (const version of ["", "-1", ".1", "1 2", "1/2", "^1.0.0", ">=1"]) {
			t2.throws(
				() => lib.parsePackageSpec(`foo@${version}`),
				new lib.ValidationError(`Invalid plugin version: ${version}`),
				version,
			);
		}
	});
});

t.test("checkRegistry()", async t1 => {
	t1.test("returns the name when the package exists", async t2 => {
		const { urls, inits } = mockFetch(t2, () => ({ ok: true, status: 200 }));
		t2.equal(await lib.checkRegistry("@scope/foo"), "@scope/foo");
		t2.strictSame(urls, ["https://registry.npmjs.com/@scope/foo"]);
		t2.equal(inits[0]!.method, "HEAD");
		t2.ok(inits[0]!.signal instanceof AbortSignal);
	});
	t1.test("returns the spec with a version when the version exists", async t2 => {
		const { urls } = mockFetch(t2, () => ({ ok: true, status: 200 }));
		t2.equal(await lib.checkRegistry("foo", "1.0.0+build"), "foo@1.0.0+build");
		t2.strictSame(urls, ["https://registry.npmjs.com/foo/1.0.0%2Bbuild"]);
	});
	t1.test("throws NotFoundError when the registry does not have it", async t2 => {
		mockFetch(t2, () => ({ ok: false, status: 404 }));
		await t2.rejects(lib.checkRegistry("foo"), new lib.NotFoundError("Unknown plugin: foo"));
		await t2.rejects(lib.checkRegistry("foo", "9.9.9"), new lib.NotFoundError("Unknown plugin: foo@9.9.9"));
	});
	t1.test("passes on fetch errors", async t2 => {
		mockFetch(t2, () => { throw new Error("network down"); });
		await t2.rejects(lib.checkRegistry("foo"), new Error("network down"));
	});
});

t.test("fetchLatestVersions()", async t1 => {
	t1.test("returns the latest version of found packages", async t2 => {
		t2.capture(lib.logger, "warn");
		const { urls, inits } = registry(t2);
		const names = ["latest-a", "@scope/latest-b", "missing-a", "broken-a"];
		const versions = await lib.fetchLatestVersions(names, new Map());
		t2.strictSame(versions, { "latest-a": "1.2.3", "@scope/latest-b": "1.2.3" });
		t2.strictSame(urls.sort(), [
			"https://registry.npmjs.com/@scope/latest-b/latest",
			"https://registry.npmjs.com/broken-a/latest",
			"https://registry.npmjs.com/latest-a/latest",
			"https://registry.npmjs.com/missing-a/latest",
		]);
		t2.ok(inits.every(init => init?.signal instanceof AbortSignal), "lookups have a timeout");
	});
	t1.test("looks up duplicate names once", async t2 => {
		const { urls } = registry(t2);
		t2.strictSame(await lib.fetchLatestVersions(["a", "a", "a"], new Map()), { a: "1.2.3" });
		t2.equal(urls.length, 1);
	});
	t1.test("returns nothing for no packages", async t2 => {
		const { urls } = registry(t2);
		t2.strictSame(await lib.fetchLatestVersions([], new Map()), {});
		t2.equal(urls.length, 0);
	});
	t1.test("leaves out packages without a version", async t2 => {
		mockFetch(t2, () => jsonResponse({}));
		const cache: lib.LatestVersionCache = new Map();
		t2.strictSame(await lib.fetchLatestVersions(["a"], cache), {});
		t2.equal(cache.get("a")!.version, undefined);
	});
	t1.test("caches found and missing packages", async t2 => {
		const { urls } = registry(t2);
		const cache: lib.LatestVersionCache = new Map();
		await lib.fetchLatestVersions(["cached-a", "missing-b"], cache);
		t2.equal(urls.length, 2);
		t2.strictSame(await lib.fetchLatestVersions(["cached-a", "missing-b"], cache), { "cached-a": "1.2.3" });
		t2.equal(urls.length, 2);
		t2.equal(cache.get("cached-a")!.version, "1.2.3");
		t2.ok(cache.has("missing-b"));
		t2.equal(cache.get("missing-b")!.version, undefined);
	});
	t1.test("uses versions already in the cache", async t2 => {
		const { urls } = registry(t2);
		const cache: lib.LatestVersionCache = new Map([["a", { version: "0.1.0", fetchedAt: Date.now() }]]);
		t2.strictSame(await lib.fetchLatestVersions(["a"], cache), { a: "0.1.0" });
		t2.equal(urls.length, 0);
	});
	t1.test("does not cache network errors or refusals and logs them", async t2 => {
		const warnings = t2.capture(lib.logger, "warn");
		const { urls } = registry(t2);
		const cache: lib.LatestVersionCache = new Map();
		await lib.fetchLatestVersions(["broken-b", "limited-a"], cache);
		t2.equal(cache.size, 0);
		await lib.fetchLatestVersions(["broken-b", "limited-a"], cache);
		t2.equal(urls.length, 4);
		t2.strictSame(warnings().map(call => call.args[0]).sort(), [
			"Failed to look up latest version of broken-b: network down",
			"Failed to look up latest version of broken-b: network down",
			"Failed to look up latest version of limited-a: 429",
			"Failed to look up latest version of limited-a: 429",
		]);
	});
	t1.test("drops expired lookups", async t2 => {
		registry(t2);
		const cache: lib.LatestVersionCache = new Map([
			["expired", { version: "0.0.1", fetchedAt: Date.now() - 10 * 60e3 }],
			["recent", { version: "0.0.1", fetchedAt: Date.now() - 60e3 }],
		]);
		await lib.fetchLatestVersions(["fresh"], cache);
		t2.strictSame([...cache.keys()], ["recent", "fresh"]);
	});
	t1.test("evicts the oldest lookup when the cache is full", async t2 => {
		registry(t2);
		const cache: lib.LatestVersionCache = new Map();
		for (let i = 0; i < 1000; i++) {
			cache.set(`filler-${i}`, { version: "1.0.0", fetchedAt: Date.now() });
		}
		await lib.fetchLatestVersions(["newest"], cache);
		t2.equal(cache.size, 1000);
		t2.notOk(cache.has("filler-0"));
		t2.ok(cache.has("filler-1"));
		t2.equal(cache.get("newest")!.version, "1.2.3");
	});
	t1.test("limits concurrent lookups to 8", async t2 => {
		let active = 0;
		let maxActive = 0;
		mockFetch(t2, async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolve => setImmediate(resolve));
			active -= 1;
			return jsonResponse({ version: "1.0.0" });
		});
		const names = Array.from({ length: 50 }, (_, i) => `package-${i}`);
		t2.equal(Object.keys(await lib.fetchLatestVersions(names, new Map())).length, 50);
		t2.equal(maxActive, 8);
	});
	t1.test("rejects pinned versions and invalid names", async t2 => {
		const { urls } = registry(t2);
		await t2.rejects(
			lib.fetchLatestVersions(["ok", "foo@1.0.0"], new Map()),
			new lib.ValidationError("Invalid plugin name: foo@1.0.0"),
		);
		await t2.rejects(
			lib.fetchLatestVersions(["foo bar"], new Map()),
			new lib.ValidationError("Invalid plugin name: foo bar"),
		);
		t2.equal(urls.length, 0);
	});
	t1.test("rejects more than 500 packages", async t2 => {
		registry(t2);
		const names = Array.from({ length: 501 }, (_, i) => `package-${i}`);
		await t2.rejects(lib.fetchLatestVersions(names, new Map()), new lib.ValidationError("Too many packages"));
		t2.equal(Object.keys(await lib.fetchLatestVersions(names.slice(1), new Map())).length, 500);
	});
});

t.test("searchPlugins()", async t1 => {
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

	t1.test("queries the registry with the plugin keyword", async t2 => {
		const { urls, inits } = mockFetch(t2, () => jsonResponse(registryResponse));
		const response = await lib.searchPlugins("foo", 2, 10);
		const url = new URL(urls[0]);
		t2.equal(url.origin + url.pathname, "https://registry.npmjs.com/-/v1/search");
		t2.equal(url.searchParams.get("text"), "keywords:clusterio-plugin foo");
		t2.equal(url.searchParams.get("size"), "10");
		t2.equal(url.searchParams.get("from"), "10");
		t2.ok(inits[0]!.signal instanceof AbortSignal);
		t2.strictSame(response, new lib.PluginSearchRequest.Response(1, [
			new lib.PluginSearchResult(
				"@clusterio/plugin-foo", "1.0.0", "Foo", "bar", "2026-01-01T00:00:00.000Z",
				"https://example.com", "https://github.com/example/foo",
				"https://www.npmjs.com/package/@clusterio/plugin-foo",
			),
		]));
	});
	t1.test("omits the query when empty", async t2 => {
		const { urls } = mockFetch(t2, () => jsonResponse({ total: 0, objects: [] }));
		const response = await lib.searchPlugins("", 1, 250);
		const url = new URL(urls[0]);
		t2.equal(url.searchParams.get("text"), "keywords:clusterio-plugin");
		t2.equal(url.searchParams.get("size"), "250");
		t2.equal(url.searchParams.get("from"), "0");
		t2.strictSame(response, new lib.PluginSearchRequest.Response(0, []));
	});
	t1.test("drops optional fields the registry sends as null", async t2 => {
		mockFetch(t2, () => jsonResponse({ total: 2, objects: [
			{ package: {
				name: "foo", version: "1.0.0", description: null, date: null,
				publisher: { username: null }, links: { npm: null, homepage: null, repository: null },
			} },
			{ package: { name: "bar", version: "1.0.0", publisher: null, links: null } },
		] }));
		const response = await lib.searchPlugins("", 1, 20);
		t2.strictSame(response, new lib.PluginSearchRequest.Response(2, [
			new lib.PluginSearchResult("foo", "1.0.0"),
			new lib.PluginSearchResult("bar", "1.0.0"),
		]));
		const validate = lib.compile(lib.PluginSearchRequest.Response.jsonSchema as any);
		t2.ok(validate(JSON.parse(JSON.stringify(response))), JSON.stringify(validate.errors));
	});
	t1.test("handles missing optional fields", async t2 => {
		mockFetch(t2, () => jsonResponse({ total: 1, objects: [{ package: { name: "foo", version: "1.0.0" } }] }));
		const response = await lib.searchPlugins("", 1, 20);
		t2.strictSame(response.results, [new lib.PluginSearchResult("foo", "1.0.0")]);
	});
	t1.test("rejects invalid paging", async t2 => {
		const { urls } = mockFetch(t2, () => jsonResponse({ total: 0, objects: [] }));
		for (const [page, pageSize] of [[0, 20], [1, 0], [1, 251]]) {
			await t2.rejects(
				lib.searchPlugins("", page, pageSize),
				new lib.ValidationError("Invalid page or page size"),
				`${page} ${pageSize}`,
			);
		}
		t2.equal(urls.length, 0);
	});
	t1.test("rejects queries over 214 characters", async t2 => {
		mockFetch(t2, () => jsonResponse({ total: 0, objects: [] }));
		await t2.rejects(lib.searchPlugins("a".repeat(215), 1, 20), new lib.ValidationError("Search query too long"));
		await t2.resolves(lib.searchPlugins("a".repeat(214), 1, 20));
	});
	t1.test("throws UnavailableError when the registry errors", async t2 => {
		mockFetch(t2, () => ({ ok: false, status: 503, statusText: "Service Unavailable" }));
		await t2.rejects(
			lib.searchPlugins("", 1, 20),
			new lib.UnavailableError("npm registry search failed: 503 Service Unavailable"),
		);
	});
});
