const assert = require("assert").strict;
const { readFile } = require("fs-extra");

const { fetchFactorioVersions } = require("@clusterio/lib");
const { slowTest } = require("../../integration");

describe("FactorioVersions", function() {
	describe("fetchFactorioVersions", function() {
		const originalFetch = global.fetch;

		beforeEach(() => {
			global.fetch = undefined;
		});

		afterEach(() => {
			global.fetch = originalFetch;
		});

		function mockFetch(html) {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () => html,
			};

			global.fetch = async () => mockResponse;
		}

		it("fetches and parsed versions with stable / experimental flags", async function() {
			mockFetch(`
				<html>
					<body>
						<a class="
							slot-button-inline
							version-button-experimental
						" href="/download/archive/2.0.73">
						2.0.73
						</a>
					</body>
					<body>
						<a class="
							slot-button-inline
							version-button-stable
						" href="/download/archive/2.0.72">
						2.0.72
						</a>
					</body>
				</html>
			`);

			const versions = await fetchFactorioVersions();
			assert.deepEqual(versions, [
				{
					stable: false,
					version: "2.0.73",
					headlessUrl: "www.factorio.com/get-download/2.0.73/headless/linux64",
				},
				{
					stable: true,
					version: "2.0.72",
					headlessUrl: "www.factorio.com/get-download/2.0.72/headless/linux64",
				},
			]);
		});
		it("deduplicates versions by last occurrence", async function() {
			mockFetch(`
				<html>
					<body>
						<a class="
							slot-button-inline
							version-button-experimental
						" href="/download/archive/2.0.73">
						2.0.73
						</a>
					</body>
					<body>
						<a class="
							slot-button-inline
							version-button-stable
						" href="/download/archive/2.0.73">
						2.0.73
						</a>
					</body>
				</html>
			`);

			const versions = await fetchFactorioVersions();
			assert.deepEqual(versions, [
				{
					stable: true,
					version: "2.0.73",
					headlessUrl: "www.factorio.com/get-download/2.0.73/headless/linux64",
				},
			]);
		});
		it("thorws on HTTP error status", async function() {
			const mockResponse = {
				ok: false,
				status: 500,
				statusText: "Server Error",
				text: async () => "",
			};

			global.fetch = async () => mockResponse;

			await assert.rejects(fetchFactorioVersions(), /HTTP 500 Server Error/);
		});
		it("thorws on network error status", async function() {
			global.fetch = async () => {
				throw new Error("Network Error");
			};

			await assert.rejects(fetchFactorioVersions(), /Network Error/);
		});
		it("parses versions from saved html file", async function() {
			mockFetch(await readFile("test/file/html/factorio-download-archive.html"));

			const versions = await fetchFactorioVersions();
			assert.equal(versions.length, 105);
			assert.equal(versions.filter(v => v.stable).length, 48);
			assert.equal(versions.filter(v => !v.stable).length, 57);
		});
		it("parses versions from live api", async function() {
			slowTest(this);
			global.fetch = originalFetch;

			const versions = await fetchFactorioVersions();
			assert.ok(versions.length >= 105);
			assert.ok(versions.filter(v => v.stable).length >= 48);
			assert.ok(versions.filter(v => !v.stable).length >= 57);
		});
	});
});
