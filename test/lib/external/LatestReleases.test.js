const assert = require("assert").strict;

const { fetchLatestReleases, resolveReleaseChannel } = require("@clusterio/lib");
const { slowTest } = require("../../integration");

describe("LatestReleases", function() {
	describe("fetchLatestReleases", function() {
		const originalFetch = global.fetch;

		beforeEach(() => {
			global.fetch = undefined;
		});

		afterEach(() => {
			global.fetch = originalFetch;
		});

		const sample = {
			experimental: { alpha: "2.1.8", demo: "2.0.77", expansion: "2.1.8", headless: "2.1.8" },
			stable: { alpha: "2.0.77", demo: "2.0.77", expansion: "2.0.77", headless: "2.0.77" },
		};

		function mockFetch(json) {
			global.fetch = async () => ({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => json,
			});
		}

		it("fetches and returns the releases json", async function() {
			mockFetch(sample);

			const releases = await fetchLatestReleases();
			assert.deepEqual(releases, sample);
		});
		it("throws on HTTP error status", async function() {
			global.fetch = async () => ({
				ok: false,
				status: 500,
				statusText: "Server Error",
				json: async () => ({}),
			});

			await assert.rejects(fetchLatestReleases(), /HTTP 500 Server Error/);
		});
		it("throws on network error", async function() {
			global.fetch = async () => {
				throw new Error("Network Error");
			};

			await assert.rejects(fetchLatestReleases(), /Network Error/);
		});
		it("fetches from the live api", async function() {
			slowTest(this);
			global.fetch = originalFetch;

			const releases = await fetchLatestReleases();
			assert.ok(releases.stable, "expected a stable channel");
			assert.ok(releases.experimental, "expected an experimental channel");
			assert.equal(typeof releases.stable.headless, "string");
		});
	});

	describe("resolveReleaseChannel", function() {
		const releases = {
			experimental: { alpha: "2.1.8", demo: "2.0.77", headless: "2.1.8" },
			stable: { alpha: "2.0.77", headless: "2.0.77" },
			// A channel without a headless build, to exercise the fallback.
			oddball: { alpha: "1.2.3" },
		};

		it("returns the headless build version by default", function() {
			assert.equal(resolveReleaseChannel(releases, "stable"), "2.0.77");
			assert.equal(resolveReleaseChannel(releases, "experimental"), "2.1.8");
		});
		it("returns the requested build version", function() {
			assert.equal(resolveReleaseChannel(releases, "experimental", "demo"), "2.0.77");
		});
		it("falls back to the first build when headless is missing", function() {
			assert.equal(resolveReleaseChannel(releases, "oddball"), "1.2.3");
		});
		it("returns undefined for an unknown channel", function() {
			assert.equal(resolveReleaseChannel(releases, "nightly"), undefined);
		});
	});
});
