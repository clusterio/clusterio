import t from "tap";
import fs from "node:fs/promises";
import path from "node:path";
import * as lib from "@clusterio/lib";

function args(config: string, overrides: Partial<Parameters<typeof lib.loadConfigFromArgs>[0]> = {}) {
	return { config, bypassLockFile: false, createConfig: false, _: ["run"], ...overrides };
}

async function exists(file: string) {
	return fs.access(file).then(() => true, () => false);
}

t.test("loadConfigFromArgs()", async t1 => {
	t1.test("loads an existing config", async t2 => {
		const dir = t2.testdir({ "config.json": JSON.stringify({ "ctl.controller_url": "http://example/foo" }) });
		const file = path.join(dir, "config.json");
		t2.capture(lib.logger, "verbose");
		const [config, lock] = await lib.loadConfigFromArgs(args(file), lib.CtlConfig, "control");
		t2.ok(config instanceof lib.CtlConfig);
		t2.equal(config.get("ctl.controller_url"), "http://example/foo");
		t2.ok(lock instanceof lib.LockFile);
		t2.equal(await exists(`${file}.lock`), false, "does not acquire the lock");
	});

	t1.test("uses the existing config when createConfig is set", async t2 => {
		const dir = t2.testdir({ "config.json": JSON.stringify({ "ctl.controller_url": "http://example/foo" }) });
		t2.capture(lib.logger, "info");
		const [config] = await lib.loadConfigFromArgs(
			args(path.join(dir, "config.json"), { createConfig: true }), lib.CtlConfig, "control",
		);
		t2.equal(config.get("ctl.controller_url"), "http://example/foo");
	});

	t1.test("rejects a missing config", async t2 => {
		const file = path.join(t2.testdir(), "missing.json");
		t2.capture(lib.logger, "verbose");
		await t2.rejects(
			lib.loadConfigFromArgs(args(file), lib.CtlConfig, "control"),
			{ name: "StartupError", message: `Failed to load ${file}: Error: ENOENT` },
		);
		t2.equal(await exists(file), false);
	});

	t1.test("rejects an invalid config even when createConfig is set", async t2 => {
		const dir = t2.testdir({ "config.json": "{ invalid" });
		const file = path.join(dir, "config.json");
		t2.capture(lib.logger, "info");
		await t2.rejects(
			lib.loadConfigFromArgs(args(file, { createConfig: true }), lib.CtlConfig, "control"),
			{ name: "StartupError", message: `Failed to load ${file}: SyntaxError` },
		);
		t2.equal(await fs.readFile(file, "utf8"), "{ invalid", "leaves the file alone");
	});

	t1.test("creates the config when createConfig is set", async t2 => {
		const file = path.join(t2.testdir(), "config.json");
		const info = t2.capture(lib.logger, "info");
		const [config] = await lib.loadConfigFromArgs(
			args(file, { createConfig: true }), lib.CtlConfig, "control",
		);
		t2.equal(config.get("ctl.controller_url"), null);
		t2.equal(config.filepath, file);
		t2.strictSame(info().map(c => c.args[0]), [`Creating config at ${file}`]);
		t2.same(JSON.parse(await fs.readFile(file, "utf8")), config.toJSON());
	});

	t1.test("creates the config for the config create command", async t2 => {
		const file = path.join(t2.testdir(), "config.json");
		t2.capture(lib.logger, "info");
		await lib.loadConfigFromArgs(args(file, { _: ["config", "create"] }), lib.CtlConfig, "control");
		t2.equal(await exists(file), true);
	});

	t1.test("does not create the config for other config commands", async t2 => {
		const file = path.join(t2.testdir(), "config.json");
		t2.capture(lib.logger, "verbose");
		for (const command of [["config", "list"], ["create"], ["foo", "create"]]) {
			await t2.rejects(
				lib.loadConfigFromArgs(args(file, { _: command }), lib.CtlConfig, "control"),
				{ name: "StartupError" },
			);
		}
		t2.equal(await exists(file), false);
	});

	t1.test("logs loading at verbose level for control only", async t2 => {
		const dir = t2.testdir({
			"ctl.json": "{}",
			"controller.json": "{}",
		});
		const verbose = t2.capture(lib.logger, "verbose");
		const info = t2.capture(lib.logger, "info");
		const ctlFile = path.join(dir, "ctl.json");
		const controllerFile = path.join(dir, "controller.json");
		await lib.loadConfigFromArgs(args(ctlFile), lib.CtlConfig, "control");
		await lib.loadConfigFromArgs(args(controllerFile), lib.ControllerConfig, "controller");
		t2.strictSame(verbose().map(c => c.args[0]), [`Loading config at ${ctlFile}`]);
		t2.strictSame(info().map(c => c.args[0]), [`Loading config at ${controllerFile}`]);
	});

	t1.test("removes the lock file when bypassLockFile is set", async t2 => {
		const dir = t2.testdir({ "config.json": "{}", "config.json.lock": "1 2\n" });
		const file = path.join(dir, "config.json");
		t2.capture(lib.logger, "verbose");
		await lib.loadConfigFromArgs(args(file, { bypassLockFile: true }), lib.CtlConfig, "control");
		t2.equal(await exists(`${file}.lock`), false);
	});

	t1.test("keeps the lock file when bypassLockFile is not set", async t2 => {
		const dir = t2.testdir({ "config.json": "{}", "config.json.lock": "1 2\n" });
		const file = path.join(dir, "config.json");
		t2.capture(lib.logger, "verbose");
		await lib.loadConfigFromArgs(args(file), lib.CtlConfig, "control");
		t2.equal(await exists(`${file}.lock`), true);
	});

	t1.test("ignores a missing lock file when bypassLockFile is set", async t2 => {
		const dir = t2.testdir({ "config.json": "{}" });
		t2.capture(lib.logger, "verbose");
		const [config] = await lib.loadConfigFromArgs(
			args(path.join(dir, "config.json"), { bypassLockFile: true }), lib.CtlConfig, "control",
		);
		t2.ok(config);
	});

	t1.test("formats errors without a stack", async t2 => {
		t2.capture(lib.logger, "verbose");
		for (const [thrown, text] of [[{ message: "no stack" }, "no stack"], ["a string", "a string"]] as const) {
			class FailingConfig extends lib.CtlConfig {
				static async fromFile(): Promise<any> {
					throw thrown;
				}
			}
			await t2.rejects(
				lib.loadConfigFromArgs(args("config.json"), FailingConfig, "control"),
				new lib.StartupError(`Failed to load config.json: ${text}`),
			);
		}
	});
});
