import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";

const archiveUrl = "https://factorio.com/download/archive/";

// Answer fetch with the given response and record the requested URLs
function mockFetch(t1: Test, respond: () => Promise<Response>) {
	const urls: unknown[] = [];
	t1.intercept(globalThis, "fetch", { value: async (url: unknown) => { urls.push(url); return respond(); } });
	return urls;
}

function anchor(kind: string, version: string) {
	return `<a class=" slot-button-inline version-button-${kind} " href="/download/archive/${version}">${version}</a>`;
}

function headless(version: string, stable: boolean) {
	return { version, stable, headlessUrl: `https://www.factorio.com/get-download/${version}/headless/linux64` };
}

t.test("hasFactorioHeadless()", async t1 => {
	const cases: [lib.FullVersion, lib.FactorioHeadlessPlatform, lib.FactorioHeadlessArch, boolean][] = [
		["0.17.79", "linux", "x64", true],
		["2.1.17", "linux", "arm64", false],
		["2.1.18", "linux", "arm64", true],
		["2.1.24", "win32", "x64", false],
		["2.1.24", "win32", "arm64", false],
	];
	for (const [version, platform, arch, expected] of cases) {
		t1.test(`returns ${expected} for ${version} ${platform} ${arch}`, async t2 => {
			t2.equal(lib.hasFactorioHeadless(version, platform, arch), expected);
		});
	}
	t1.test("starts arm64 at minimumArm64HeadlessVersion", async t2 => {
		t2.equal(lib.hasFactorioHeadless(lib.minimumArm64HeadlessVersion as lib.FullVersion, "linux", "arm64"), true);
	});
});

t.test("factorioHeadlessUrl()", async t1 => {
	t1.test("returns the linux64 build for x64", async t2 => {
		t2.equal(
			lib.factorioHeadlessUrl("2.1.24", "linux", "x64"),
			"https://www.factorio.com/get-download/2.1.24/headless/linux64",
		);
	});
	t1.test("returns the linux-arm64 build for arm64", async t2 => {
		t2.equal(
			lib.factorioHeadlessUrl("2.1.24", "linux", "arm64"),
			"https://www.factorio.com/get-download/2.1.24/headless/linux-arm64",
		);
	});
	t1.test("throws for builds that do not exist", async t2 => {
		t2.throws(
			() => lib.factorioHeadlessUrl("2.1.24", "win32", "x64"),
			new Error("Factorio 2.1.24 has no headless build for win32 x64"),
		);
		t2.throws(
			() => lib.factorioHeadlessUrl("2.1.17", "linux", "arm64"),
			new Error("Factorio 2.1.17 has no headless build for linux arm64"),
		);
	});
});

t.test("fetchFactorioVersions()", async t1 => {
	t1.test("parses stable and experimental versions from the archive page", async t2 => {
		const urls = mockFetch(t2, async () => new Response(`
			<html><body>
				<a class="
					slot-button-inline
					version-button-experimental
				" href="/download/archive/2.0.73">
				2.0.73
				</a>
				${anchor("stable", "2.0.72")}
			</body></html>
		`));
		t2.strictSame(await lib.fetchFactorioVersions(), [headless("2.0.73", false), headless("2.0.72", true)]);
		t2.strictSame(urls, [archiveUrl]);
	});
	t1.test("keeps the last entry of a repeated version", async t2 => {
		mockFetch(t2, async () => new Response(anchor("experimental", "2.0.73") + anchor("stable", "2.0.73")));
		t2.strictSame(await lib.fetchFactorioVersions(), [headless("2.0.73", true)]);
	});
	t1.test("leaves out versions before multiplayer support", async t2 => {
		mockFetch(t2, async () => new Response(
			anchor("stable", "0.12.34") + anchor("stable", "0.12.35") + anchor("stable", "0.11.22")
		));
		t2.strictSame(await lib.fetchFactorioVersions(), [headless("0.12.35", true)]);
	});
	t1.test("ignores links that are not version buttons", async t2 => {
		mockFetch(t2, async () => new Response([
			'<a class="other-button" href="/download/archive/2.0.70">2.0.70</a>',
			'<a class="version-button-stable" href="/download/2.0.71">2.0.71</a>',
			'<a class="version-button-alpha" href="/download/archive/2.0.72">2.0.72</a>',
			'<a class="version-button-stable" href="/download/archive/2.0">2.0</a>',
			'<a class="version-button-stable" href="/download/archive/2.0x74">2.0x74</a>',
			anchor("stable", "2.0.73"),
		].join("\n")));
		t2.strictSame(await lib.fetchFactorioVersions(), [headless("2.0.73", true)]);
	});
	t1.test("returns nothing for an empty page", async t2 => {
		mockFetch(t2, async () => new Response(""));
		t2.strictSame(await lib.fetchFactorioVersions(), []);
	});
	t1.test("throws on HTTP error status", async t2 => {
		mockFetch(t2, async () => new Response("", { status: 500, statusText: "Server Error" }));
		await t2.rejects(
			lib.fetchFactorioVersions(),
			new Error(`Failed to fetch Factorio versions from ${archiveUrl}: HTTP 500 Server Error`),
		);
	});
	t1.test("throws on network error", async t2 => {
		mockFetch(t2, async () => { throw new TypeError("fetch failed"); });
		await t2.rejects(
			lib.fetchFactorioVersions(),
			new Error(`Failed to fetch Factorio versions from ${archiveUrl}: TypeError: fetch failed`),
		);
	});
});
