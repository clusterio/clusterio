import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import t from "tap";
import * as lib from "@clusterio/lib";

const buildModPath = fileURLToPath(import.meta.resolve("@clusterio/lib/build_mod.js"));

function modFixture(info: Record<string, unknown>, files: Record<string, any> = {}) {
	return {
		"info.json": JSON.stringify(info),
		"control.lua": "-- control",
		module: { "a.lua": "-- a" },
		...files,
	};
}

/** Files in a zip with their content */
async function readZip(zipPath: string) {
	const zip = await lib.ZipArchive.fromFile(zipPath);
	try {
		const files: Record<string, string> = {};
		for (const [name, entry] of zip.entries) {
			files[name] = (await zip.readEntry(entry)).toString();
		}
		return files;
	} finally {
		zip.close();
	}
}

/** Files in a directory with their content, by posix path */
async function readTree(dir: string) {
	const files: Record<string, string> = {};
	for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			const filePath = path.join(entry.parentPath, entry.name);
			files[path.relative(dir, filePath).split(path.sep).join("/")] = await fs.readFile(filePath, "utf8");
		}
	}
	return files;
}

function setup(t1: any, info: Record<string, unknown>, files: Record<string, any> = {}) {
	const dir = t1.testdir({ mod: modFixture(info, files), output: {} });
	const logs = t1.capture(console, "log");
	return {
		dir,
		sourceDir: path.join(dir, "mod"),
		outputDir: path.join(dir, "output"),
		logs: () => logs().map((call: any) => call.args.join(" ")) as string[],
	};
}

function runCli(args: string[], cwd: string) {
	return new Promise<{ code: number | null, output: string }>((resolve, reject) => {
		const child = spawn(process.execPath, [buildModPath, ...args], { cwd });
		let output = "";
		child.stdout.on("data", chunk => { output += chunk; });
		child.stderr.on("data", chunk => { output += chunk; });
		child.on("error", reject);
		child.on("close", code => resolve({ code, output }));
	});
}

const info = { name: "test_mod", version: "1.2.3", factorio_version: "2.0", title: "Test" };

t.test("build()", async t1 => {
	t1.test("pack", async t2 => {
		t2.test("writes a zip with the mod files under the mod name", async t3 => {
			const { sourceDir, outputDir, logs } = setup(t3, info);
			await lib.build({ build: true, pack: true, sourceDir, outputDir });
			const zipPath = path.join(outputDir, "test_mod_1.2.3.zip");
			t3.strictSame(await readZip(zipPath), {
				"test_mod_1.2.3/control.lua": "-- control",
				"test_mod_1.2.3/module/a.lua": "-- a",
				"test_mod_1.2.3/info.json": JSON.stringify(info, null, "\t"),
			});
			t3.strictSame(logs(), [`Writing ${zipPath}`]);
		});
		t2.test("creates the output directory", async t3 => {
			const { sourceDir, dir } = setup(t3, info);
			const outputDir = path.join(dir, "new", "output");
			await lib.build({ build: true, pack: true, sourceDir, outputDir });
			t3.strictSame(await fs.readdir(outputDir), ["test_mod_1.2.3.zip"]);
		});
		t2.test("uses modName when given", async t3 => {
			const { sourceDir, outputDir } = setup(t3, info);
			await lib.build({ build: true, pack: true, sourceDir, outputDir, modName: "custom" });
			const files = await readZip(path.join(outputDir, "custom.zip"));
			t3.ok(files["custom/info.json"]);
		});
		t2.test("adds additional files from outside the source dir", async t3 => {
			const { sourceDir, outputDir } = setup(t3, {
				...info,
				additional_files: { "shared.lua": ["..", "shared", "shared.lua"], "x.lua": ["module", "a.lua"] },
			});
			await fs.mkdir(path.join(sourceDir, "..", "shared"));
			await fs.writeFile(path.join(sourceDir, "..", "shared", "shared.lua"), "-- shared");
			await lib.build({ build: true, pack: true, sourceDir, outputDir });
			const files = await readZip(path.join(outputDir, "test_mod_1.2.3.zip"));
			t3.equal(files["test_mod_1.2.3/shared.lua"], "-- shared");
			t3.equal(files["test_mod_1.2.3/x.lua"], "-- a");
			t3.strictSame(JSON.parse(files["test_mod_1.2.3/info.json"]), info, "additional_files is left out");
		});
		t2.test("rejects and removes the zip when an additional file is missing", async t3 => {
			const { sourceDir, outputDir } = setup(t3, { ...info, additional_files: { "x.lua": ["missing.lua"] } });
			const err = await lib.build({ build: true, pack: true, sourceDir, outputDir }).catch(e => e);
			t3.equal(err.message, `Error reading additional file ${path.join(sourceDir, "missing.lua")}`);
			t3.equal(err.cause.code, "ENOENT");
			t3.strictSame(await fs.readdir(outputDir), []);
		});
		t2.test("rejects and removes the zip when a source file is unreadable", {
			skip: process.platform === "win32" || process.getuid?.() === 0 ? "permissions not enforced" : false,
		}, async t3 => {
			const files: Record<string, any> = { "unreadable.lua": "" };
			for (let i = 0; i < 20; i++) {
				files[`dir${i}`] = { "file.lua": "" };
			}
			const { sourceDir, outputDir } = setup(t3, info, files);
			await fs.chmod(path.join(sourceDir, "unreadable.lua"), 0o000);
			await t3.rejects(lib.build({ build: true, pack: true, sourceDir, outputDir }), { code: "EACCES" });
			t3.strictSame(await fs.readdir(outputDir), []);
		});
	});

	t1.test("no pack", async t2 => {
		t2.test("copies the mod into a directory", async t3 => {
			const { sourceDir, outputDir, logs } = setup(t3, { ...info, additional_files: {} });
			await lib.build({ build: true, pack: false, sourceDir, outputDir });
			const modDir = path.join(outputDir, "test_mod_1.2.3");
			t3.strictSame(await readTree(modDir), {
				"control.lua": "-- control",
				"info.json": JSON.stringify(info, null, "\t"),
				"module/a.lua": "-- a",
			});
			t3.strictSame(logs(), [`Removing potentially existing build ${modDir}`, `Building ${modDir}`]);
		});
		t2.test("replaces an existing build", async t3 => {
			const { sourceDir, outputDir } = setup(t3, { ...info, additional_files: {} });
			const modDir = path.join(outputDir, "test_mod_1.2.3");
			await fs.mkdir(modDir);
			await fs.writeFile(path.join(modDir, "stale.lua"), "");
			await lib.build({ build: true, pack: false, sourceDir, outputDir });
			t3.notOk((await fs.readdir(modDir)).includes("stale.lua"));
		});
		t2.test("copies a mod without additional_files", async t3 => {
			const { sourceDir, outputDir } = setup(t3, info);
			await lib.build({ build: true, pack: false, sourceDir, outputDir });
			t3.ok((await fs.readdir(path.join(outputDir, "test_mod_1.2.3"))).includes("info.json"));
		});
		t2.test("adds additional files relative to the source dir like pack does", async t3 => {
			const { sourceDir, outputDir } = setup(t3, { ...info, additional_files: { "x.lua": ["module", "a.lua"] } });
			await lib.build({ build: true, pack: false, sourceDir, outputDir });
			t3.equal(await fs.readFile(path.join(outputDir, "test_mod_1.2.3", "x.lua"), "utf8"), "-- a");
		});
	});

	t1.test("overrides factorio_version and dependencies", async t2 => {
		const { sourceDir, outputDir } = setup(t2, info);
		await lib.build({
			build: true, pack: true, sourceDir, outputDir, factorioVersion: "2.1", dependencies: ["base >= 2.1"],
		});
		const files = await readZip(path.join(outputDir, "test_mod_1.2.3.zip"));
		t2.strictSame(JSON.parse(files["test_mod_1.2.3/info.json"]), {
			...info, factorio_version: "2.1", dependencies: ["base >= 2.1"],
		});
	});

	t1.test("builds each variant", async t2 => {
		const { sourceDir, outputDir } = setup(t2, {
			name: "test_mod",
			title: "Test",
			variants: [{ version: "1.0.0", factorio_version: "1.1" }, { version: "2.0.0", factorio_version: "2.0" }],
		});
		await lib.build({ build: true, pack: true, sourceDir, outputDir });
		t2.strictSame((await fs.readdir(outputDir)).sort(), ["test_mod_1.0.0.zip", "test_mod_2.0.0.zip"]);
		const files = await readZip(path.join(outputDir, "test_mod_1.0.0.zip"));
		t2.strictSame(JSON.parse(files["test_mod_1.0.0/info.json"]), {
			name: "test_mod", title: "Test", version: "1.0.0", factorio_version: "1.1",
		});
	});

	t1.test("clean", async t2 => {
		t2.test("removes previous builds of this mod only", async t3 => {
			const { sourceDir, outputDir, logs } = setup(t3, info);
			for (const name of ["test_mod_0.1.0.zip", "other_mod_0.1.0.zip", "test_mod_1.0", "test_mod_notes.txt"]) {
				await fs.writeFile(path.join(outputDir, name), "");
			}
			await fs.mkdir(path.join(outputDir, "test_mod_0.2.0"));
			await lib.build({ clean: true, build: false, sourceDir, outputDir });
			t3.strictSame(
				(await fs.readdir(outputDir)).sort(),
				["other_mod_0.1.0.zip", "test_mod_1.0", "test_mod_notes.txt"],
			);
			t3.strictSame(logs().sort(), [
				`Removing ${path.join(outputDir, "test_mod_0.1.0.zip")}`,
				`Removing ${path.join(outputDir, "test_mod_0.2.0")}`,
			]);
		});
		t2.test("then builds the new version", async t3 => {
			const { sourceDir, outputDir } = setup(t3, info);
			await fs.writeFile(path.join(outputDir, "test_mod_0.1.0.zip"), "");
			await lib.build({ clean: true, build: true, pack: true, sourceDir, outputDir });
			t3.strictSame(await fs.readdir(outputDir), ["test_mod_1.2.3.zip"]);
		});
		t2.test("works before the output directory exists", async t3 => {
			const { sourceDir, dir } = setup(t3, info);
			const outputDir = path.join(dir, "missing");
			await lib.build({ clean: true, build: true, pack: true, sourceDir, outputDir });
			t3.strictSame(await fs.readdir(outputDir), ["test_mod_1.2.3.zip"]);
		});
		t2.test("rejects when the output path is a file", async t3 => {
			const { sourceDir, dir } = setup(t3, info);
			const outputDir = path.join(dir, "file");
			await fs.writeFile(outputDir, "");
			await t3.rejects(
				lib.build({ clean: true, build: true, pack: true, sourceDir, outputDir }),
				{ code: "ENOTDIR" },
			);
		});
	});

	t1.test("does nothing with build false", async t2 => {
		const { sourceDir, outputDir, logs } = setup(t2, info);
		await lib.build({ build: false, sourceDir, outputDir });
		t2.strictSame(await fs.readdir(outputDir), []);
		t2.strictSame(logs(), []);
	});

	t1.test("rejects a missing or invalid info.json", async t2 => {
		const dir = t2.testdir({ empty: {}, invalid: { "info.json": "{" } });
		const empty = path.join(dir, "empty");
		const invalid = path.join(dir, "invalid");
		await t2.rejects(lib.build({ build: true, sourceDir: empty, outputDir: dir }), { code: "ENOENT" });
		await t2.rejects(lib.build({ build: true, sourceDir: invalid, outputDir: dir }), SyntaxError);
	});
});

t.test("command line", async t1 => {
	t1.test("builds a zip into dist/factorio by default", async t2 => {
		const dir = t2.testdir({ mod: modFixture(info) });
		const { code, output } = await runCli(["--source-dir", "mod"], dir);
		t2.equal(code, 0, output);
		t2.strictSame(await fs.readdir(path.join(dir, "dist", "factorio")), ["test_mod_1.2.3.zip"]);
	});
	t1.test("takes the options", async t2 => {
		const dir = t2.testdir({
			mod: modFixture({ ...info, additional_files: {} }),
			out: { "test_mod_0.0.1.zip": "" },
		});
		const { code, output } = await runCli(
			["--source-dir", "mod", "--output-dir", "out", "--clean", "--no-pack", "--factorio-version", "2.1"],
			dir,
		);
		t2.equal(code, 0, output);
		t2.strictSame(await fs.readdir(path.join(dir, "out")), ["test_mod_1.2.3"]);
		const built = JSON.parse(await fs.readFile(path.join(dir, "out", "test_mod_1.2.3", "info.json"), "utf8"));
		t2.equal(built.factorio_version, "2.1");
	});
	t1.test("rejects unknown options", async t2 => {
		const dir = t2.testdir({ mod: modFixture(info) });
		const { code, output } = await runCli(["--source-dir", "mod", "--bogus"], dir);
		t2.equal(code, 1);
		t2.match(output, "Unknown argument: bogus");
	});
	t1.test("exits with an error code when the build fails", async t2 => {
		const dir = t2.testdir({});
		const { code, output } = await runCli(["--source-dir", "missing"], dir);
		t2.match(output, "ENOENT");
		t2.not(code, 0);
	});
});
