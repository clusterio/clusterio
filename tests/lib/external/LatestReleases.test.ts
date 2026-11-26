import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

const releasesUrl = "https://factorio.com/api/latest-releases";

function mockFetch(t1: Test, respond: () => Promise<Response>) {
	const urls: unknown[] = [];
	t1.intercept(globalThis, "fetch", { value: async (url: unknown) => { urls.push(url); return respond(); } });
	return urls;
}

const sample = {
	experimental: { alpha: "2.1.8", demo: "2.0.77", expansion: "2.1.8", headless: "2.1.8" },
	stable: { alpha: "2.0.77", demo: "2.0.77", expansion: "2.0.77", headless: "2.0.77" },
};

t.test("fetchLatestReleases()", async t1 => {
	t1.test("returns the releases json", async t2 => {
		const urls = mockFetch(t2, async () => Response.json(sample));
		t2.strictSame(await lib.fetchLatestReleases(), sample);
		t2.strictSame(urls, [releasesUrl]);
	});
	t1.test("throws on HTTP error status", async t2 => {
		mockFetch(t2, async () => new Response("{}", { status: 503, statusText: "Service Unavailable" }));
		await t2.rejects(
			lib.fetchLatestReleases(),
			new Error(`Failed to fetch Factorio releases from ${releasesUrl}: HTTP 503 Service Unavailable`),
		);
	});
	t1.test("throws on network error", async t2 => {
		mockFetch(t2, async () => { throw new TypeError("fetch failed"); });
		await t2.rejects(
			lib.fetchLatestReleases(),
			new Error(`Failed to fetch Factorio releases from ${releasesUrl}: TypeError: fetch failed`),
		);
	});
	t1.test("rejects a body that is not JSON", async t2 => {
		mockFetch(t2, async () => new Response("<html>"));
		await t2.rejects(lib.fetchLatestReleases(), { name: "SyntaxError" });
	});
});

t.test("resolveReleaseChannel()", async t1 => {
	const releases: lib.LatestReleases = {
		experimental: { alpha: "2.1.8", demo: "2.0.77", headless: "2.1.8" },
		stable: { alpha: "2.0.77", headless: "2.0.77" },
		noHeadless: { alpha: "1.2.3", demo: "1.2.0" },
		empty: {},
	};
	t1.test("returns the headless version by default", async t2 => {
		t2.equal(lib.resolveReleaseChannel(releases, "stable"), "2.0.77");
		t2.equal(lib.resolveReleaseChannel(releases, "experimental"), "2.1.8");
	});
	t1.test("returns the requested build", async t2 => {
		t2.equal(lib.resolveReleaseChannel(releases, "experimental", "demo"), "2.0.77");
	});
	t1.test("falls back to the first build when the requested one is missing", async t2 => {
		t2.equal(lib.resolveReleaseChannel(releases, "noHeadless"), "1.2.3");
		t2.equal(lib.resolveReleaseChannel(releases, "stable", "demo"), "2.0.77");
	});
	t1.test("returns undefined for an unknown or empty channel", async t2 => {
		t2.equal(lib.resolveReleaseChannel(releases, "nightly"), undefined);
		t2.equal(lib.resolveReleaseChannel(releases, "empty"), undefined);
	});
});
