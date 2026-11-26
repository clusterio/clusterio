import t, { type Test } from "tap";
import fs from "node:fs/promises";
import path from "node:path";
import * as lib from "@clusterio/lib";

const { ModStore, ModInfo, ModVersionEquality } = lib;

// SourceVersion is a branded string
function v(version: string) {
	return version as lib.SourceVersion;
}

function infoJson(name: string, version: string, extra: Record<string, unknown> = {}) {
	return {
		name,
		version: v(version),
		title: `${name} title`,
		author: "Author",
		factorio_version: v("1.1"),
		dependencies: ["base >= 1.1"],
		...extra,
	};
}

async function zipBuffer(files: [string, string | Buffer][]) {
	const writer = new lib.ZipWriter();
	const chunks: Buffer[] = [];
	writer.outputStream.on("data", chunk => chunks.push(chunk));
	for (const [name, content] of files) {
		await writer.addBuffer(Buffer.from(content), name);
	}
	await writer.end();
	return Buffer.concat(chunks);
}

async function modZip(name: string, version: string, extra: Record<string, unknown> = {}) {
	return zipBuffer([
		[`${name}_${version}/info.json`, JSON.stringify(infoJson(name, version, extra))],
		[`${name}_${version}/data.lua`, "-- data"],
	]);
}

async function writeMod(dir: string, name: string, version: string, extra: Record<string, unknown> = {}) {
	const file = path.join(dir, ModInfo.filename(name, v(version)));
	await fs.writeFile(file, await modZip(name, version, extra));
	return file;
}

function trackChanges(store: InstanceType<typeof ModStore>) {
	const changes: lib.ModInfo[] = [];
	store.on("change", mod => changes.push(mod));
	return changes;
}

function pair(name: string, version: string) {
	return { name, version: ModVersionEquality.fromString(version) };
}

function release(name: string, version: string) {
	return {
		version,
		info_json: { factorio_version: "1.1" },
		released_at: "2020-01-01T00:00:00.000Z",
		download_url: `/download/${name}/${version}`,
		file_name: ModInfo.filename(name, v(version)),
		sha1: "0".repeat(40),
	};
}

function portalMod(name: string, extra: Record<string, unknown> = {}) {
	return { name, title: name, summary: "", owner: "owner", downloads_count: 0, ...extra };
}

type FetchCall = { url: URL, init?: RequestInit };

// Replace fetch for the duration of the test, handler gets the parsed URL
function mockFetch(t1: Test, handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
	const calls: FetchCall[] = [];
	t1.intercept(globalThis, "fetch", {
		value: async (input: string | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			calls.push({ url, init });
			return handler(url, init);
		},
	});
	return calls;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function newStore(t1: Test) {
	const dir = t1.testdir();
	return new ModStore(dir, new Map());
}

t.test("ModStore", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("stores the directory and files", async t3 => {
			const files = new Map();
			const store = new ModStore("mods", files);
			t3.equal(store.modsDirectory, "mods");
			t3.equal(store.files, files);
		});
	});

	t1.test("getMod()", async t2 => {
		const mod = ModInfo.fromJSON({ ...infoJson("a", "1.0.0"), sha1: "abc" });
		const store = new ModStore("mods", new Map([[mod.filename, mod]]));
		t2.test("returns a stored mod", async t3 => {
			t3.equal(store.getMod("a", v("1.0.0")), mod);
		});
		t2.test("returns undefined for a missing mod", async t3 => {
			t3.equal(store.getMod("a", v("2.0.0")), undefined);
			t3.equal(store.getMod("b", v("1.0.0")), undefined);
		});
		t2.test("checks the hash when given", async t3 => {
			t3.equal(store.getMod("a", v("1.0.0"), "abc"), mod);
			t3.equal(store.getMod("a", v("1.0.0"), "def"), undefined);
			t3.equal(store.getMod("a", v("1.0.0"), ""), mod, "empty hash is ignored");
		});
	});

	t1.test("mods()", async t2 => {
		t2.test("iterates the stored mods", async t3 => {
			const a = ModInfo.fromJSON(infoJson("a", "1.0.0"));
			const b = ModInfo.fromJSON(infoJson("b", "1.0.0"));
			const store = new ModStore("mods", new Map([[a.filename, a], [b.filename, b]]));
			t3.strictSame([...store.mods()], [a, b]);
		});
	});

	t1.test("readModInfo()", async t2 => {
		t2.test("reads info.json along with file details", async t3 => {
			const dir = t3.testdir();
			const file = await writeMod(dir, "a", "1.2.3", { description: "desc" });
			const stat = await fs.stat(file);
			const mod = await ModStore.readModInfo(file);
			t3.match(mod, {
				name: "a",
				version: "1.2.3",
				title: "a title",
				author: "Author",
				description: "desc",
				factorioVersion: "1.1",
				size: stat.size,
				sha1: await lib.hashFile(file),
				mtimeMs: stat.mtimeMs,
				updatedAtMs: stat.mtimeMs,
				isDeleted: false,
			});
		});
		t2.test("reads info.json from a root folder with any name", async t3 => {
			const dir = t3.testdir();
			const file = path.join(dir, "a_1.0.0.zip");
			await fs.writeFile(file, await zipBuffer([["other/info.json", JSON.stringify(infoJson("a", "1.0.0"))]]));
			t3.equal((await ModStore.readModInfo(file)).name, "a");
		});
		t2.test("rejects a mod without info.json", async t3 => {
			const dir = t3.testdir();
			const file = path.join(dir, "a_1.0.0.zip");
			await fs.writeFile(file, await zipBuffer([["a_1.0.0/data.lua", ""]]));
			await t3.rejects(ModStore.readModInfo(file), new Error("Mod contains no info.json file"));
		});
		t2.test("rejects an info.json that fails validation", async t3 => {
			const dir = t3.testdir();
			const file = path.join(dir, "a_1.0.0.zip");
			await fs.writeFile(file, await zipBuffer([["a/info.json", JSON.stringify({ name: "a" })]]));
			await t3.rejects(ModStore.readModInfo(file), new Error("Mod's info.json is not valid"));
		});
		t2.test("rejects an info.json that is not JSON", async t3 => {
			const dir = t3.testdir();
			const file = path.join(dir, "a_1.0.0.zip");
			await fs.writeFile(file, await zipBuffer([["a/info.json", "{ invalid"]]));
			await t3.rejects(ModStore.readModInfo(file), SyntaxError);
		});
		t2.test("rejects an empty zip", async t3 => {
			const dir = t3.testdir();
			const file = path.join(dir, "a_1.0.0.zip");
			await fs.writeFile(file, await zipBuffer([]));
			await t3.rejects(ModStore.readModInfo(file), new Error("Empty zip file"));
		});
		t2.test("rejects a file that is not a zip", async t3 => {
			const dir = t3.testdir({ "a_1.0.0.zip": "not a zip" });
			await t3.rejects(ModStore.readModInfo(path.join(dir, "a_1.0.0.zip")));
		});
	});

	t1.test("static loadFile()", async t2 => {
		t2.test("loads a mod with the expected filename", async t3 => {
			const dir = t3.testdir();
			await writeMod(dir, "a", "1.0.0");
			const mod = await ModStore.loadFile(dir, "a_1.0.0.zip");
			t3.equal(mod.filename, "a_1.0.0.zip");
		});
		t2.test("rejects a mod whose filename does not match", async t3 => {
			const dir = t3.testdir();
			await fs.writeFile(path.join(dir, "renamed.zip"), await modZip("a", "1.0.0"));
			await t3.rejects(
				ModStore.loadFile(dir, "renamed.zip"),
				new Error("filename does not match the expected name a_1.0.0.zip."),
			);
		});
	});

	t1.test("loadFile()", async t2 => {
		t2.test("adds the mod and emits a change", async t3 => {
			const store = await newStore(t3);
			await writeMod(store.modsDirectory, "a", "1.0.0");
			const changes = trackChanges(store);
			const mod = await store.loadFile("a_1.0.0.zip");
			t3.equal(store.files.get("a_1.0.0.zip"), mod);
			t3.strictSame(changes, [mod]);
		});
		t2.test("replaces an existing entry", async t3 => {
			const store = await newStore(t3);
			const old = ModInfo.fromJSON(infoJson("a", "1.0.0"));
			store.files.set(old.filename, old);
			await writeMod(store.modsDirectory, "a", "1.0.0", { title: "new" });
			await store.loadFile("a_1.0.0.zip");
			t3.equal(store.getMod("a", v("1.0.0"))!.title, "new");
		});
	});

	t1.test("addMod()", async t2 => {
		t2.test("stores the mod and emits a change", async t3 => {
			const store = new ModStore("mods", new Map());
			const changes = trackChanges(store);
			const mod = ModInfo.fromJSON(infoJson("a", "1.0.0"));
			store.addMod(mod);
			t3.equal(store.files.get("a_1.0.0.zip"), mod);
			t3.strictSame(changes, [mod]);
		});
	});

	t1.test("deleteFile()", async t2 => {
		t2.test("deletes the file and emits the mod marked deleted", async t3 => {
			const store = await newStore(t3);
			const file = await writeMod(store.modsDirectory, "a", "1.0.0");
			const mod = await store.loadFile("a_1.0.0.zip");
			const changes = trackChanges(store);
			t3.intercept(Date, "now", { value: () => 12345 });
			await store.deleteFile("a_1.0.0.zip");
			await t3.rejects(fs.access(file));
			t3.equal(store.files.size, 0);
			t3.equal(mod.isDeleted, true);
			t3.equal(mod.updatedAtMs, 12345);
			t3.strictSame(changes, [mod]);
		});
		t2.test("rejects a mod that is not stored", async t3 => {
			const store = await newStore(t3);
			await t3.rejects(store.deleteFile("a_1.0.0.zip"), new Error("Mod a_1.0.0.zip does not exist"));
		});
		t2.test("keeps the mod when the file cannot be removed", async t3 => {
			const store = await newStore(t3);
			const mod = ModInfo.fromJSON(infoJson("a", "1.0.0"));
			store.addMod(mod);
			const changes = trackChanges(store);
			await t3.rejects(store.deleteFile("a_1.0.0.zip"), { code: "ENOENT" });
			t3.equal(store.files.get("a_1.0.0.zip"), mod);
			t3.equal(mod.isDeleted, false);
			t3.strictSame(changes, []);
		});
	});

	t1.test("loadMod() and deleteMod()", async t2 => {
		t2.test("load and delete by name and version", async t3 => {
			const store = await newStore(t3);
			await writeMod(store.modsDirectory, "a", "1.0.0");
			const mod = await store.loadMod("a", v("1.0.0"));
			t3.equal(store.getMod("a", v("1.0.0")), mod);
			await store.deleteMod("a", v("1.0.0"));
			t3.equal(store.getMod("a", v("1.0.0")), undefined);
		});
	});

	t1.test("fromDirectory()", async t2 => {
		const cacheName = "mod-info-cache.json";

		t2.test("loads an empty directory without writing a cache", async t3 => {
			const dir = t3.testdir();
			const store = await ModStore.fromDirectory(dir);
			t3.equal(store.modsDirectory, dir);
			t3.equal(store.files.size, 0);
			await t3.rejects(fs.access(path.join(dir, cacheName)));
		});

		t2.test("loads mods and writes the cache", async t3 => {
			const dir = t3.testdir();
			await writeMod(dir, "a", "1.0.0");
			await writeMod(dir, "b", "2.0.0");
			const info = t3.capture(lib.logger, "info");
			const store = await ModStore.fromDirectory(dir);
			t3.strictSame([...store.files.keys()].sort(), ["a_1.0.0.zip", "b_2.0.0.zip"]);
			const cache = JSON.parse(await fs.readFile(path.join(dir, cacheName), "utf8"));
			t3.strictSame(cache.map((m: any) => m.name).sort(), ["a", "b"]);
			t3.strictSame(cache.find((m: any) => m.name === "a"), store.getMod("a", v("1.0.0"))!.toJSON());
			t3.match(
				info().map(c => c.args[0]),
				["Loading info for Mod", "Loading info for Mod", "Loaded info for 2 mods"],
			);
		});

		t2.test("ignores directories, other files and temporary zips", async t3 => {
			const dir = t3.testdir({ "subdir": {}, "readme.txt": "", "a_1.0.0.tmp.zip": "", "b_1.0.0.TMP.ZIP": "" });
			await writeMod(dir, "a", "1.0.0");
			t3.capture(lib.logger, "info");
			const warnings = t3.capture(lib.logger, "warn");
			const store = await ModStore.fromDirectory(dir);
			t3.strictSame([...store.files.keys()], ["a_1.0.0.zip"]);
			t3.strictSame(warnings().map(c => c.args[0]), [`Ignoring subdir${path.sep} in mods directory.`]);
		});

		t2.test("accepts upper case extensions", async t3 => {
			const dir = t3.testdir();
			await fs.writeFile(path.join(dir, "a_1.0.0.ZIP"), await modZip("a", "1.0.0"));
			t3.capture(lib.logger, "info");
			const errors = t3.capture(lib.logger, "error");
			const store = await ModStore.fromDirectory(dir);
			// The file is read, but its name does not match the expected one
			t3.equal(store.files.size, 0);
			t3.strictSame(errors().map(c => c.args[0]), [
				"Error loading mod a_1.0.0.ZIP: filename does not match the expected name a_1.0.0.zip.",
			]);
		});

		t2.test("logs and skips mods that fail to load", async t3 => {
			const dir = t3.testdir({ "broken_1.0.0.zip": "not a zip" });
			await writeMod(dir, "a", "1.0.0");
			t3.capture(lib.logger, "info");
			const errors = t3.capture(lib.logger, "error");
			const store = await ModStore.fromDirectory(dir);
			t3.strictSame([...store.files.keys()], ["a_1.0.0.zip"]);
			t3.match(errors().map(c => c.args[0]), [/^Error loading mod broken_1\.0\.0\.zip: /]);
		});

		t2.test("uses cached info when the mtime matches", async t3 => {
			const dir = t3.testdir();
			const file = await writeMod(dir, "a", "1.0.0");
			const { mtimeMs } = await fs.stat(file);
			const cached = { ...infoJson("a", "1.0.0"), title: "cached", mtime_ms: mtimeMs };
			await fs.writeFile(path.join(dir, cacheName), JSON.stringify([cached]));
			const info = t3.capture(lib.logger, "info");
			const store = await ModStore.fromDirectory(dir);
			t3.equal(store.getMod("a", v("1.0.0"))!.title, "cached");
			t3.notOk(info().some(c => String(c.args[0]).startsWith("Loading info for Mod")));
		});

		t2.test("reloads mods whose mtime changed", async t3 => {
			const dir = t3.testdir();
			const file = await writeMod(dir, "a", "1.0.0");
			const { mtimeMs } = await fs.stat(file);
			const cached = { ...infoJson("a", "1.0.0"), title: "cached", mtime_ms: mtimeMs - 1000 };
			await fs.writeFile(path.join(dir, cacheName), JSON.stringify([cached]));
			t3.capture(lib.logger, "info");
			const store = await ModStore.fromDirectory(dir);
			t3.equal(store.getMod("a", v("1.0.0"))!.title, "a title");
			const cache = JSON.parse(await fs.readFile(path.join(dir, cacheName), "utf8"));
			t3.equal(cache[0].title, "a title");
		});

		t2.test("drops cache entries for mods that are gone", async t3 => {
			const dir = t3.testdir();
			await writeMod(dir, "a", "1.0.0");
			await fs.writeFile(path.join(dir, cacheName), JSON.stringify([infoJson("gone", "1.0.0")]));
			t3.capture(lib.logger, "info");
			const store = await ModStore.fromDirectory(dir);
			t3.strictSame([...store.files.keys()], ["a_1.0.0.zip"]);
			const cache = JSON.parse(await fs.readFile(path.join(dir, cacheName), "utf8"));
			t3.strictSame(cache.map((m: any) => m.name), ["a"]);
		});

		t2.test("warns about an unreadable cache and loads the mods", async t3 => {
			const dir = t3.testdir({ [cacheName]: "{ invalid" });
			await writeMod(dir, "a", "1.0.0");
			t3.capture(lib.logger, "info");
			const warnings = t3.capture(lib.logger, "warn");
			const store = await ModStore.fromDirectory(dir);
			t3.equal(store.files.size, 1);
			t3.match(warnings().map(c => c.args[0]), [`Error loading ${path.join(dir, cacheName)}:\nSyntaxError`]);
		});

		t2.test("rejects a mods directory that does not exist", async t3 => {
			await t3.rejects(ModStore.fromDirectory(path.join(t3.testdir(), "missing")), { code: "ENOENT" });
		});
	});

	t1.test("downloadMods()", async t2 => {
		// Portal that serves mods from a name -> response details map and zips on download
		function portal(t3: Test, mods: Record<string, Record<string, unknown>>) {
			return mockFetch(t3, async (url, init) => {
				if (url.pathname === "/api/mods") {
					const names = (init!.body as URLSearchParams).get("namelist")!.split(",");
					return json({
						pagination: null,
						results: names.filter(n => mods[n]).map(n => portalMod(n, mods[n])),
					});
				}
				const match = /^\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
				if (match) {
					return new Response(await modZip(match[1], match[2]));
				}
				return new Response("not found", { status: 404, statusText: "Not Found" });
			});
		}

		t2.test("downloads the release matching the version", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, {
				a: { releases: [release("a", "1.0.0"), release("a", "1.1.0"), release("a", "2.0.0")] },
			});
			const changes = trackChanges(store);
			await store.downloadMods([pair("a", "< 2.0.0")], "user", "secret", "2.0");
			t3.strictSame(changes.map(m => m.filename), ["a_1.0.0.zip"]);
			t3.ok(store.getMod("a", v("1.0.0")));
			await fs.access(path.join(store.modsDirectory, "a_1.0.0.zip"));

			const [query, download] = calls;
			t3.equal(query.url.origin + query.url.pathname, "https://mods.factorio.com/api/mods");
			t3.equal(query.url.searchParams.get("page_size"), "max");
			t3.equal(query.url.searchParams.get("version"), "2.0");
			t3.equal(query.init!.method, "POST");
			t3.equal((query.init!.body as URLSearchParams).get("namelist"), "a");
			t3.equal(download.url.origin + download.url.pathname, "https://mods.factorio.com/download/a/1.0.0");
			t3.equal(download.url.searchParams.get("username"), "user");
			t3.equal(download.url.searchParams.get("token"), "secret");
		});

		t2.test("uses latest_release when releases is missing", async t3 => {
			const store = await newStore(t3);
			portal(t3, { a: { latest_release: release("a", "1.5.0") } });
			await store.downloadMods([pair("a", ">= 1.0.0")], "user", "secret");
			t3.ok(store.getMod("a", v("1.5.0")));
		});

		t2.test("defaults to Factorio 1.1 and skips built in mods", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, { a: { releases: [release("a", "1.0.0")] } });
			await store.downloadMods(
				[pair("base", "1.1.0"), pair("core", "1.1.0"), pair("a", "1.0.0")], "user", "secret",
			);
			t3.equal(calls[0].url.searchParams.get("version"), "1.1");
			t3.equal((calls[0].init!.body as URLSearchParams).get("namelist"), "a");
		});

		t2.test("skips space age built in mods for 2.0", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, {});
			await store.downloadMods(
				[pair("space-age", "2.0.0"), pair("quality", "2.0.0"), pair("a", "1.0.0")], "user", "secret", "2.0",
			);
			t3.equal((calls[0].init!.body as URLSearchParams).get("namelist"), "a");
		});

		t2.test("makes no request when every mod is built in", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, {});
			await store.downloadMods([pair("base", "1.1.0")], "user", "secret");
			await store.downloadMods([], "user", "secret");
			t3.equal(calls.length, 0);
		});

		t2.test("splits requests into chunks of 500 mods", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, {});
			const mods = Array.from({ length: 1001 }, (_, i) => pair(`m${i}`, "1.0.0"));
			await store.downloadMods(mods, "user", "secret");
			const namelists = calls.map(c => (c.init!.body as URLSearchParams).get("namelist")!.split(","));
			t3.strictSame(namelists.map(n => n.length), [500, 500, 1]);
			t3.strictSame(namelists.flat(), mods.map(m => m.name));
		});

		t2.test("warns when no release matches the version", async t3 => {
			const store = await newStore(t3);
			const calls = portal(t3, { a: { releases: [release("a", "1.0.0")] } });
			const warnings = t3.capture(lib.logger, "warn");
			await store.downloadMods([pair("a", ">= 2.0.0")], "user", "secret");
			t3.strictSame(warnings().map(c => c.args[0]), ["Mod release matching version >= 2.0.0 not found."]);
			t3.equal(calls.length, 1);
			t3.equal(store.files.size, 0);
		});

		t2.test("logs a failed download and continues with other mods", async t3 => {
			const store = await newStore(t3);
			const broken = { ...release("a", "1.0.0"), download_url: "/missing" };
			portal(t3, { a: { releases: [broken] }, b: { releases: [release("b", "1.0.0")] } });
			const errors = t3.capture(lib.logger, "error");
			await store.downloadMods([pair("a", "1.0.0"), pair("b", "1.0.0")], "user", "secret");
			const messages = errors().map(c => c.args[0]);
			t3.match(messages, [/^Failed to download or load mod a_1\.0\.0\.zip \(= 1\.0\.0\): /]);
			t3.notMatch(messages[0], "secret", "does not log the token");
			t3.strictSame([...store.files.keys()], ["b_1.0.0.zip"]);
		});

		t2.test("logs a downloaded file that fails to load", async t3 => {
			const store = await newStore(t3);
			// Portal file name does not match the mod inside the zip
			const mismatched = { ...release("a", "1.0.0"), file_name: "other_1.0.0.zip" };
			portal(t3, { a: { releases: [mismatched] } });
			const errors = t3.capture(lib.logger, "error");
			await store.downloadMods([pair("a", "1.0.0")], "user", "secret");
			t3.strictSame(errors().map(c => c.args[0]), [
				"Failed to download or load mod other_1.0.0.zip (= 1.0.0): " +
				"filename does not match the expected name a_1.0.0.zip.",
			]);
			t3.equal(store.files.size, 0);
		});

		t2.test("rejects a portal mod without releases", async t3 => {
			const store = await newStore(t3);
			portal(t3, { a: {} });
			await t3.rejects(
				store.downloadMods([pair("a", "1.0.0")], "user", "secret"),
				new Error("Mod a has no releases or latest_release"),
			);
		});

		t2.test("rejects with the portal's error message", async t3 => {
			const store = await newStore(t3);
			mockFetch(t3, () => json({ message: "Unsupported version" }, 400));
			await t3.rejects(
				store.downloadMods([pair("a", "1.0.0")], "user", "secret"),
				new Error("Mod portal request to https://mods.factorio.com/api/mods?page_size=max&version=1.1 " +
					"failed: Unsupported version"),
			);
		});

		t2.test("rejects with the status when the error has no message", async t3 => {
			const store = await newStore(t3);
			const responses = [
				new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
				new Response(JSON.stringify({ message: 5 }), { status: 502, statusText: "Bad Gateway" }),
				new Response("null", { status: 502, statusText: "Bad Gateway" }),
			];
			mockFetch(t3, () => responses.shift()!);
			for (let i = 0; i < 3; i++) {
				await t3.rejects(
					store.downloadMods([pair("a", "1.0.0")], "user", "secret"),
					{ message: /failed: 502 Bad Gateway$/ },
				);
			}
		});
	});

	t1.test("filterInstalled()", async t2 => {
		const a = ModInfo.fromJSON(infoJson("a", "1.2.0"));
		const b = ModInfo.fromJSON(infoJson("b", "2.0.0"));
		const store = new ModStore("mods", new Map([[a.filename, a], [b.filename, b]]));
		const mods = [pair("a", ">= 1.0.0"), pair("a", "< 1.0.0"), pair("b", "2.0.0"), pair("c", "1.0.0")];

		t2.test("keeps installed mods matching the version", async t3 => {
			t3.strictSame(store.filterInstalled(mods, true), [mods[0], mods[2]]);
		});
		t2.test("keeps mods that are not installed", async t3 => {
			t3.strictSame(store.filterInstalled(mods, false), [mods[1], mods[3]]);
		});
		t2.test("handles an empty store", async t3 => {
			const empty = new ModStore("mods", new Map());
			t3.strictSame(empty.filterInstalled(mods, true), []);
			t3.strictSame(empty.filterInstalled(mods, false), mods);
		});
	});

	t1.test("fetchAllModsFromPortal()", async t2 => {
		t2.test("fetches every page", async t3 => {
			const pages = [[portalMod("a"), portalMod("b")], [portalMod("c")]];
			const calls = mockFetch(t3, url => {
				const page = Number(url.searchParams.get("page"));
				return json({ pagination: { page_count: pages.length }, results: pages[page - 1] });
			});
			t3.capture(lib.logger, "info");
			t3.capture(lib.logger, "verbose");
			const mods = await ModStore.fetchAllModsFromPortal("2.0", 2, true);
			t3.strictSame(mods.map(m => m.name), ["a", "b", "c"]);
			t3.strictSame(calls.map(c => Object.fromEntries(c.url.searchParams)), [
				{ page_size: "2", version: "2.0", page: "1", hide_deprecated: "true" },
				{ page_size: "2", version: "2.0", page: "2", hide_deprecated: "true" },
			]);
			t3.equal(calls[0].url.origin + calls[0].url.pathname, "https://mods.factorio.com/api/mods");
		});
		t2.test("does not hide deprecated mods by default", async t3 => {
			const calls = mockFetch(t3, () => json({ pagination: { page_count: 1 }, results: [] }));
			t3.capture(lib.logger, "info");
			t3.capture(lib.logger, "verbose");
			t3.strictSame(await ModStore.fetchAllModsFromPortal("1.1", 10), []);
			t3.equal(calls[0].url.searchParams.get("hide_deprecated"), "false");
		});
		t2.test("rejects with the status and body of a failed page", async t3 => {
			let page = 0;
			mockFetch(t3, () => {
				page += 1;
				return page === 1
					? json({ pagination: { page_count: 3 }, results: [] })
					: new Response("try later", { status: 503, statusText: "Service Unavailable" });
			});
			t3.capture(lib.logger, "info");
			t3.capture(lib.logger, "verbose");
			await t3.rejects(
				ModStore.fetchAllModsFromPortal("1.1", 10),
				new Error("Mod portal fetch page 2 failed: 503 Service Unavailable - try later"),
			);
		});
		t2.test("rejects with the status when the body cannot be read", async t3 => {
			mockFetch(t3, () => ({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: async () => { throw new Error("stream broke"); },
			}) as unknown as Response);
			t3.capture(lib.logger, "info");
			t3.capture(lib.logger, "verbose");
			const warnings = t3.capture(lib.logger, "warn");
			await t3.rejects(
				ModStore.fetchAllModsFromPortal("1.1", 10),
				new Error("Mod portal fetch page 1 failed: 500 Internal Server Error"),
			);
			t3.strictSame(warnings().map(c => c.args[0]), ["Failed to read response body for failed portal request"]);
		});
	});

	t1.test("fetchModReleases()", async t2 => {
		t2.test("returns the full mod details", async t3 => {
			const details = portalMod("a", { releases: [release("a", "1.0.0")] });
			const calls = mockFetch(t3, () => json(details));
			t3.strictSame(await ModStore.fetchModReleases("a"), details);
			t3.equal(calls[0].url.href, "https://mods.factorio.com/api/mods/a/full");
		});
		t2.test("rejects a failed request", async t3 => {
			mockFetch(t3, () => new Response("", { status: 404, statusText: "Not Found" }));
			await t3.rejects(
				ModStore.fetchModReleases("a"),
				new Error("Fetch: https://mods.factorio.com/api/mods/a/full returned 404 Not Found"),
			);
		});
	});
});
