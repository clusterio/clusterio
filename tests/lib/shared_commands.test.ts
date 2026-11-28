import t, { type Test } from "tap";
import fs from "node:fs/promises";
import path from "node:path";
import stream from "node:stream";
// @types/yargs is only a dev dependency of lib
// @ts-ignore
import yargs from "yargs";
import * as lib from "@clusterio/lib";

// Stand-in for npm on PATH. Installs a local package directory the way npm does for a path
// spec: symlinks it into node_modules and records it in package.json.
const fakeNpm = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const mode = process.env.FAKE_NPM_MODE;
console.log("args " + process.argv.slice(2).join(" "));
console.log("");
console.error("npm warn something");
if (mode === "fail") {
	console.error("npm error failed");
	process.exit(3);
}
if (mode !== "noop") {
	const spec = process.argv.at(-1);
	const dir = spec.replace(/^[^@]+@file:/, "");
	const name = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name;
	fs.mkdirSync("node_modules", { recursive: true });
	if (!fs.existsSync(path.join("node_modules", name))) {
		fs.symlinkSync(path.resolve(dir), path.join("node_modules", name), "dir");
	}
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	pkg.dependencies = { ...pkg.dependencies, [name]: "file:" + dir };
	fs.writeFileSync("package.json", JSON.stringify(pkg));
}
`;

// Stand-in for cmd.exe that runs the quoted command with sh
const fakeCmdExe = `#!/bin/sh
[ "$1 $2 $3" = "/d /s /c" ] || exit 99
command="$4"
command="\${command#\\"}"
exec sh -c "\${command%\\"}"
`;

const installPackageJson = JSON.stringify({ name: "clusterio-install", private: true });

function pluginPackage(pluginName: string, packageName: string, main?: string) {
	return {
		"package.json": JSON.stringify({
			name: packageName, version: "1.0.0", keywords: ["clusterio-plugin"], ...(main ? { main } : {}),
		}),
		[main ?? "index.js"]: `exports.plugin = { name: ${JSON.stringify(pluginName)} };\n`,
	};
}

// process.env only takes plain values, so t.intercept does not work on it
function setEnv(t1: Test, name: string, value: string | undefined) {
	const old = process.env[name];
	const set = (v: string | undefined) => {
		if (v === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = v;
		}
	};
	set(value);
	t1.teardown(() => set(old));
}

// Run the test in a fresh directory with the fake npm first on PATH
async function setup(t1: Test, files: Record<string, any> = {}, mode?: string) {
	const dir = t1.testdir({
		bin: { npm: fakeNpm },
		...files,
	});
	await fs.chmod(path.join(dir, "bin", "npm"), 0o755);
	const oldCwd = process.cwd();
	process.chdir(dir);
	setEnv(t1, "PATH", `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`);
	setEnv(t1, "FAKE_NPM_MODE", mode);
	t1.teardown(() => {
		process.chdir(oldCwd);
		process.exitCode = undefined;
	});
	return dir;
}

function capturePrint(t1: Test) {
	const log = t1.capture(console, "log");
	return () => log().map(c => c.args.join(" "));
}

function captureLogs(t1: Test, level: "error" | "warn" | "info") {
	const calls = t1.capture(lib.logger, level);
	return () => calls().map(c => String(c.args[0]));
}

async function pluginCommand(
	pluginList: Map<string, string>, command: string, arg?: string, pluginListPath = "plugin-list.json",
) {
	await lib.handlePluginCommand(
		{ _: ["plugin", command], package: arg, path: arg, name: arg },
		pluginList,
		pluginListPath,
	);
}

async function readPluginList() {
	return JSON.parse(await fs.readFile("plugin-list.json", "utf8"));
}

t.test("pluginCommand()", async t1 => {
	function parse(argv: string[]) {
		return yargs(argv)
			.command("plugin", "plugin", lib.pluginCommand)
			.exitProcess(false)
			.fail((msg: string, err: Error) => { throw err ?? new Error(msg); })
			.parse();
	}

	t1.test("parses the subcommands", async t2 => {
		t2.match(await parse(["plugin", "install", "pkg"]), { _: ["plugin", "install"], package: "pkg" });
		t2.match(await parse(["plugin", "add", "./p"]), { _: ["plugin", "add"], path: "./p" });
		t2.match(await parse(["plugin", "remove", "n"]), { _: ["plugin", "remove"], name: "n" });
		t2.match(await parse(["plugin", "list"]), { _: ["plugin", "list"] });
	});
	t1.test("requires a subcommand", async t2 => {
		await t2.rejects(async () => parse(["plugin"]), new Error("You need to specify a command to run"));
	});
	t1.test("rejects unknown subcommands", async t2 => {
		await t2.rejects(async () => parse(["plugin", "frob"]), { message: /Unknown argument: frob/ });
	});
});

t.test("isClusterioInstall()", async t1 => {
	t1.test("is false without a package.json", async t2 => {
		t2.equal(await lib.isClusterioInstall(t2.testdir()), false);
	});
	t1.test("is false for an unrelated package.json", async t2 => {
		const dir = t2.testdir({ "package.json": JSON.stringify({ name: "x", dependencies: { "left-pad": "1" } }) });
		t2.equal(await lib.isClusterioInstall(dir), false);
	});
	t1.test("is false for a package.json without dependencies", async t2 => {
		const dir = t2.testdir({ "package.json": JSON.stringify({ name: "x" }) });
		t2.equal(await lib.isClusterioInstall(dir), false);
	});
	t1.test("is true for the installer package.json", async t2 => {
		const dir = t2.testdir({ "package.json": installPackageJson });
		t2.equal(await lib.isClusterioInstall(dir), true);
	});
	t1.test("is true when a core package is a dependency", async t2 => {
		for (const name of ["@clusterio/controller", "@clusterio/host", "@clusterio/ctl"]) {
			const dir = t2.testdir({ "package.json": JSON.stringify({ dependencies: { [name]: "^2.0.0" } }) });
			t2.equal(await lib.isClusterioInstall(dir), true, name);
		}
	});
	t1.test("is false when only lib is a dependency", async t2 => {
		const dir = t2.testdir({ "package.json": JSON.stringify({ dependencies: { "@clusterio/lib": "^2.0.0" } }) });
		t2.equal(await lib.isClusterioInstall(dir), false);
	});
	t1.test("defaults to the current directory", async t2 => {
		await setup(t2, { "package.json": installPackageJson });
		t2.equal(await lib.isClusterioInstall(), true);
	});
	t1.test("rejects an invalid package.json", async t2 => {
		const dir = t2.testdir({ "package.json": "{ invalid" });
		await t2.rejects(lib.isClusterioInstall(dir), SyntaxError);
	});
	t1.test("rejects read errors other than a missing file", async t2 => {
		const dir = t2.testdir({ "package.json": {} });
		await t2.rejects(lib.isClusterioInstall(dir), { code: "EISDIR" });
	});
});

t.test("handlePluginCommand()", async t1 => {
	t1.test("install", async t2 => {
		t2.test("refuses to run outside a Clusterio installation", async t3 => {
			const dir = await setup(t3, { plugin: pluginPackage("my_plugin", "my_plugin_pkg") });
			const errors = captureLogs(t3, "error");
			const pluginList = new Map();
			await pluginCommand(pluginList, "install", path.join(dir, "plugin"));
			t3.equal(process.exitCode, 1);
			t3.match(errors(), [/is not a Clusterio installation/]);
			t3.equal(pluginList.size, 0);
			await t3.rejects(fs.access("node_modules"));
		});

		t2.test("installs and adds a plugin", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			const print = capturePrint(t3);
			const log = t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const pluginList = new Map();
			const spec = path.join(dir, "plugin");
			await pluginCommand(pluginList, "install", spec);
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["my_plugin", "my_plugin_pkg"]]);
			t3.strictSame(await readPluginList(), [["my_plugin", "my_plugin_pkg"]]);
			t3.strictSame(print(), ["Installed my_plugin"]);
			// stdout and stderr may interleave either way, blank lines are dropped
			t3.strictSame(log().map(c => c.args).sort(), [
				["info", `args install --save --no-audit --no-fund ${spec}`],
				["warn", "npm warn something"],
			]);
		});

		t2.test("reports a plugin that is already installed", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			const print = capturePrint(t3);
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const pluginList = new Map();
			const spec = path.join(dir, "plugin");
			await pluginCommand(pluginList, "install", spec);
			await pluginCommand(pluginList, "install", spec);
			await pluginCommand(pluginList, "install", `my_plugin_pkg@file:${spec}`);
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["my_plugin", "my_plugin_pkg"]]);
			t3.strictSame(print(), [
				"Installed my_plugin",
				"my_plugin is already installed",
				"my_plugin is already installed",
			]);
		});

		t2.test("reports a listed plugin whose package was just installed", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			const print = capturePrint(t3);
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const pluginList = new Map([["my_plugin", "my_plugin_pkg"]]);
			await pluginCommand(pluginList, "install", path.join(dir, "plugin"));
			t3.equal(process.exitCode, undefined);
			t3.strictSame(print(), ["my_plugin is already installed"]);
		});

		t2.test("fails when the package is not a plugin", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"lib": { "package.json": JSON.stringify({ name: "not_a_plugin" }) },
			});
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const warnings = captureLogs(t3, "warn");
			const errors = captureLogs(t3, "error");
			const pluginList = new Map();
			const spec = path.join(dir, "lib");
			await pluginCommand(pluginList, "install", spec);
			t3.equal(process.exitCode, 1);
			t3.equal(pluginList.size, 0);
			t3.strictSame(warnings(), [`not_a_plugin@file:${spec} is not a clusterio-plugin`]);
			t3.strictSame(errors(), [`${spec} was installed but did not provide any plugins`]);
		});

		t2.test("fails when npm exits with an error", async t3 => {
			const dir = await setup(t3, { "package.json": installPackageJson }, "fail");
			const log = t3.capture(lib.logger, "log");
			const errors = captureLogs(t3, "error");
			const pluginList = new Map();
			await pluginCommand(pluginList, "install", "some-package");
			t3.equal(process.exitCode, 1);
			t3.equal(pluginList.size, 0);
			t3.strictSame(errors(), ["Failed to install some-package: npm install exited with code 3"]);
			t3.ok(log().some(c => c.args[0] === "warn" && c.args[1] === "npm error failed"));
		});

		t2.test("runs npm.cmd through the shell on Windows", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			// Only npm.cmd is on PATH, and a .cmd file only runs through a shell
			await fs.rename(path.join(dir, "bin", "npm"), path.join(dir, "bin", "npm.js"));
			const npmCmd = '#!/bin/sh\nexec node "$(dirname "$0")/npm.js" "$@"\n';
			await fs.writeFile(path.join(dir, "bin", "npm.cmd"), npmCmd, { mode: 0o755 });
			// Node runs shell commands on Windows as: cmd.exe /d /s /c "<command>"
			await fs.writeFile(path.join(dir, "bin", "cmd.exe"), fakeCmdExe, { mode: 0o755 });
			t3.intercept(process, "platform", { value: "win32" });
			const print = capturePrint(t3);
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const pluginList = new Map();
			await pluginCommand(pluginList, "install", path.join(dir, "plugin"));
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["my_plugin", "my_plugin_pkg"]]);
			t3.strictSame(print(), ["Installed my_plugin"]);
		});

		t2.test("fails when npm cannot be started", async t3 => {
			await setup(t3, { "package.json": installPackageJson, "empty": {} });
			setEnv(t3, "PATH", path.resolve("empty"));
			const errors = captureLogs(t3, "error");
			await pluginCommand(new Map(), "install", "some-package");
			t3.equal(process.exitCode, 1);
			t3.match(errors(), [/^Failed to install some-package: spawn npm ENOENT/]);
		});

		t2.test("matches package specs by name when npm changes nothing", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"archive.tgz": "not a directory",
				"nameless": { "package.json": JSON.stringify({ version: "1.0.0" }) },
			}, "noop");
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const print = capturePrint(t3);
			const pluginList = new Map([
				["a", "foo"],
				["b", "@scope/bar"],
				["c", "archive.tgz"],
				["d", "nameless"],
			]);
			await pluginCommand(pluginList, "install", "foo@1.2.3");
			await pluginCommand(pluginList, "install", "@scope/bar@^2");
			await pluginCommand(pluginList, "install", "archive.tgz");
			await pluginCommand(pluginList, "install", "nameless");
			t3.equal(process.exitCode, undefined);
			t3.strictSame(print(), [
				"a is already installed",
				"b is already installed",
				"c is already installed",
				"d is already installed",
			]);
		});

		t2.test("rejects when a local spec has an invalid package.json", async t3 => {
			const dir = await setup(t3, {
				"package.json": installPackageJson,
				"broken": { "package.json": "{ invalid" },
			}, "noop");
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			await t3.rejects(pluginCommand(new Map(), "install", "broken"), SyntaxError);
		});

		t2.test("reads dependencies of a package.json without any", async t3 => {
			const dir = await setup(t3, {
				"package.json": JSON.stringify({ dependencies: { "@clusterio/ctl": "^2.0.0" } }),
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			t3.capture(lib.logger, "log");
			captureLogs(t3, "info");
			const print = capturePrint(t3);
			await pluginCommand(new Map(), "install", path.join(dir, "plugin"));
			t3.strictSame(print(), ["Installed my_plugin"]);
		});
	});

	t1.test("add", async t2 => {
		t2.test("adds a plugin by absolute path", async t3 => {
			const dir = await setup(t3, { plugin: pluginPackage("my_plugin", "my_plugin_pkg") });
			const print = capturePrint(t3);
			const pluginList = new Map();
			const pluginPath = path.join(dir, "plugin");
			await pluginCommand(pluginList, "add", pluginPath);
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["my_plugin", pluginPath]]);
			t3.strictSame(await readPluginList(), [["my_plugin", pluginPath]]);
			t3.strictSame(print(), ["Added my_plugin"]);
		});

		t2.test("resolves relative paths", async t3 => {
			const dir = await setup(t3, {
				work: { a: pluginPackage("a", "a_pkg") },
				b: pluginPackage("b", "b_pkg"),
			});
			process.chdir(path.join(dir, "work"));
			capturePrint(t3);
			const pluginList = new Map();
			await pluginCommand(pluginList, "add", "./a");
			await pluginCommand(pluginList, "add", "../b");
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["a", path.join(dir, "work", "a")], ["b", path.join(dir, "b")]]);
		});

		t2.test("warns for a bare path outside a Clusterio installation", async t3 => {
			await setup(t3, { plugin: pluginPackage("my_plugin", "my_plugin_pkg") });
			capturePrint(t3);
			const warnings = captureLogs(t3, "warn");
			const pluginList = new Map();
			await pluginCommand(pluginList, "add", "plugin");
			t3.equal(process.exitCode, undefined);
			t3.match(warnings(), [/is not a Clusterio installation/]);
			t3.strictSame([...pluginList], [["my_plugin", "plugin"]]);
		});

		t2.test("does not warn for a bare path inside a Clusterio installation", async t3 => {
			await setup(t3, {
				"package.json": installPackageJson,
				"plugin": pluginPackage("my_plugin", "my_plugin_pkg"),
			});
			capturePrint(t3);
			const warnings = captureLogs(t3, "warn");
			await pluginCommand(new Map(), "add", "plugin");
			t3.strictSame(warnings(), []);
		});

		t2.test("uses the main field of package.json", async t3 => {
			const dir = await setup(t3, { plugin: pluginPackage("my_plugin", "my_plugin_pkg", "entry.js") });
			capturePrint(t3);
			const pluginList = new Map();
			await pluginCommand(pluginList, "add", path.join(dir, "plugin"));
			t3.strictSame([...pluginList.keys()], ["my_plugin"]);
		});

		t2.test("fails when the plugin cannot be imported", async t3 => {
			const dir = await setup(t3);
			const errors = captureLogs(t3, "error");
			const pluginList = new Map();
			const pluginPath = path.join(dir, "missing");
			await pluginCommand(pluginList, "add", pluginPath);
			t3.equal(process.exitCode, 1);
			t3.match(errors(), [`Unable to import plugin info from ${pluginPath}:\n`]);
			t3.equal(pluginList.size, 0);
		});

		t2.test("fails when the package does not export a plugin", async t3 => {
			const dir = await setup(t3, {
				plugin: { "package.json": JSON.stringify({ name: "x" }), "index.js": "exports.other = 1;\n" },
			});
			const errors = captureLogs(t3, "error");
			const pluginList = new Map();
			await pluginCommand(pluginList, "add", path.join(dir, "plugin"));
			t3.equal(process.exitCode, 1);
			t3.strictSame(errors(), ["Plugin does not correctly export a 'plugin' object"]);
			t3.equal(pluginList.size, 0);
		});

		t2.test("fails when a plugin with the same name is listed", async t3 => {
			const dir = await setup(t3, { plugin: pluginPackage("my_plugin", "my_plugin_pkg") });
			const errors = captureLogs(t3, "error");
			const pluginList = new Map([["my_plugin", "elsewhere"]]);
			await pluginCommand(pluginList, "add", path.join(dir, "plugin"));
			t3.equal(process.exitCode, 1);
			t3.strictSame(errors(), ["Plugin with the same my_plugin already exists"]);
			t3.strictSame([...pluginList], [["my_plugin", "elsewhere"]]);
			await t3.rejects(fs.access("plugin-list.json"));
		});
	});

	t1.test("remove", async t2 => {
		t2.test("removes a listed plugin", async t3 => {
			await setup(t3);
			const print = capturePrint(t3);
			const pluginList = new Map([["a", "pa"], ["b", "pb"]]);
			await pluginCommand(pluginList, "remove", "a");
			t3.equal(process.exitCode, undefined);
			t3.strictSame([...pluginList], [["b", "pb"]]);
			t3.strictSame(await readPluginList(), [["b", "pb"]]);
			t3.strictSame(print(), ["Removed a"]);
		});
		t2.test("fails for a plugin that is not listed", async t3 => {
			await setup(t3);
			const errors = captureLogs(t3, "error");
			const pluginList = new Map([["a", "pa"]]);
			await pluginCommand(pluginList, "remove", "b");
			t3.equal(process.exitCode, 1);
			t3.strictSame(errors(), ["Plugin with name b does not exist"]);
			t3.strictSame([...pluginList], [["a", "pa"]]);
			await t3.rejects(fs.access("plugin-list.json"));
		});
	});

	t1.test("list", async t2 => {
		t2.test("prints each plugin and its path", async t3 => {
			const print = capturePrint(t3);
			await pluginCommand(new Map([["a", "pa"], ["b", "pb"]]), "list");
			t3.strictSame(print(), ["a - pa", "b - pb"]);
		});
		t2.test("prints nothing for an empty list", async t3 => {
			const print = capturePrint(t3);
			await pluginCommand(new Map(), "list");
			t3.strictSame(print(), []);
		});
	});

	t1.test("does nothing for an unknown command", async t2 => {
		const print = capturePrint(t2);
		const pluginList = new Map([["a", "pa"]]);
		await pluginCommand(pluginList, "frob", "a");
		t2.strictSame(print(), []);
		t2.strictSame([...pluginList], [["a", "pa"]]);
		t2.equal(process.exitCode, undefined);
	});
});

t.test("configCommand()", async t1 => {
	function parse(argv: string[]) {
		return yargs(argv)
			.command("config", "config", lib.configCommand)
			.exitProcess(false)
			.fail((msg: string, err: Error) => { throw err ?? new Error(msg); })
			.parse();
	}

	t1.test("parses the subcommands", async t2 => {
		t2.match(await parse(["config", "create"]), { _: ["config", "create"] });
		t2.match(await parse(["config", "set", "f", "v"]), { _: ["config", "set"], field: "f", value: "v" });
		t2.match(await parse(["config", "set", "f", "--stdin"]), { field: "f", stdin: true, value: undefined });
		t2.match(await parse(["config", "show", "f"]), { _: ["config", "show"], field: "f" });
		t2.match(await parse(["config", "list"]), { _: ["config", "list"] });
	});
	t1.test("requires a subcommand", async t2 => {
		await t2.rejects(async () => parse(["config"]), new Error("You need to specify a command to run"));
	});
});

t.test("handleConfigCommand()", async t1 => {
	async function makeConfig(t2: Test) {
		const dir = t2.testdir();
		const file = path.join(dir, "config.json");
		const config = new lib.CtlConfig("control", undefined, file);
		const lock = new lib.LockFile(`${file}.lock`);
		return { file, config, lock };
	}

	async function run(
		{ config, lock }: Awaited<ReturnType<typeof makeConfig>>, command: string, rest: Record<string, unknown> = {},
	) {
		await lib.handleConfigCommand({ _: ["config", command], ...rest }, config, lock);
	}

	async function readConfig(file: string) {
		return JSON.parse(await fs.readFile(file, "utf8"));
	}

	t1.test("create does nothing", async t2 => {
		const ctx = await makeConfig(t2);
		const print = capturePrint(t2);
		await run(ctx, "create");
		t2.strictSame(print(), []);
		await t2.rejects(fs.access(ctx.file));
	});

	t1.test("list prints every field as JSON", async t2 => {
		const ctx = await makeConfig(t2);
		ctx.config.set("ctl.controller_url", "http://x/");
		const print = capturePrint(t2);
		await run(ctx, "list");
		t2.strictSame(print(), [
			"ctl.controller_url \"http://x/\"",
			"ctl.controller_token null",
			"ctl.max_reconnect_delay 60",
		]);
	});

	t1.test("show", async t2 => {
		t2.test("prints the value of the field", async t3 => {
			const ctx = await makeConfig(t3);
			const print = capturePrint(t3);
			await run(ctx, "show", { field: "ctl.max_reconnect_delay" });
			t3.strictSame(print(), ["60"]);
		});
		t2.test("logs an unknown field", async t3 => {
			const ctx = await makeConfig(t3);
			const errors = captureLogs(t3, "error");
			await run(ctx, "show", { field: "ctl.nope" });
			t3.strictSame(errors(), ["No field named 'ctl.nope'"]);
		});
		t2.test("rethrows other errors", async t3 => {
			const ctx = await makeConfig(t3);
			t3.capture(ctx.config, "get", () => { throw new Error("boom"); });
			await t3.rejects(run(ctx, "show", { field: "ctl.max_reconnect_delay" }), new Error("boom"));
		});
	});

	t1.test("set", async t2 => {
		t2.test("sets and saves the field", async t3 => {
			const ctx = await makeConfig(t3);
			await run(ctx, "set", { field: "ctl.max_reconnect_delay", value: "5" });
			t3.equal(ctx.config.get("ctl.max_reconnect_delay"), 5);
			t3.equal((await readConfig(ctx.file))["ctl.max_reconnect_delay"], 5);
			await t3.rejects(fs.access(`${ctx.file}.lock`), "releases the lock");
		});
		t2.test("sets the field to null without a value", async t3 => {
			const ctx = await makeConfig(t3);
			ctx.config.set("ctl.controller_url", "http://x/");
			await run(ctx, "set", { field: "ctl.controller_url" });
			t3.equal(ctx.config.get("ctl.controller_url"), null);
			t3.equal((await readConfig(ctx.file))["ctl.controller_url"], null);
		});
		t2.test("reads the value from stdin", async t3 => {
			const ctx = await makeConfig(t3);
			t3.intercept(process, "stdin", { value: stream.Readable.from([Buffer.from("http://a/\r\n")]) });
			await run(ctx, "set", { field: "ctl.controller_url", stdin: true });
			t3.equal(ctx.config.get("ctl.controller_url"), "http://a/");
		});
		t2.test("strips only one trailing newline from stdin", async t3 => {
			const ctx = await makeConfig(t3);
			t3.intercept(process, "stdin", { value: stream.Readable.from([Buffer.from("a\n"), Buffer.from("b\n\n")]) });
			await run(ctx, "set", { field: "ctl.controller_url", stdin: true });
			t3.equal(ctx.config.get("ctl.controller_url"), "a\nb\n");
		});
		t2.test("logs an unknown field", async t3 => {
			const ctx = await makeConfig(t3);
			const errors = captureLogs(t3, "error");
			await run(ctx, "set", { field: "ctl.nope", value: "1" });
			t3.strictSame(errors(), ["No field named 'ctl.nope'"]);
			await t3.rejects(fs.access(ctx.file));
			await t3.rejects(fs.access(`${ctx.file}.lock`), "releases the lock");
		});
		t2.test("logs an invalid value", async t3 => {
			const ctx = await makeConfig(t3);
			const errors = captureLogs(t3, "error");
			await run(ctx, "set", { field: "ctl.max_reconnect_delay", value: "abc" });
			await run(ctx, "set", { field: "ctl.max_reconnect_delay" });
			t3.strictSame(errors(), [
				"Expected type of ctl.max_reconnect_delay to be number, not string",
				"Field ctl.max_reconnect_delay cannot be null",
			]);
			t3.equal(ctx.config.get("ctl.max_reconnect_delay"), 60);
		});
		t2.test("rethrows other errors", async t3 => {
			const ctx = await makeConfig(t3);
			t3.capture(ctx.config, "save", async () => { throw new Error("disk full"); });
			await t3.rejects(run(ctx, "set", { field: "ctl.controller_url", value: "x" }), new Error("disk full"));
			await ctx.lock.release().catch(() => {});
		});
		t2.test("releases the lock when saving fails", async t3 => {
			const ctx = await makeConfig(t3);
			t3.capture(ctx.config, "save", async () => { throw new Error("disk full"); });
			await run(ctx, "set", { field: "ctl.controller_url", value: "x" }).catch(() => {});
			const held = await fs.access(`${ctx.file}.lock`).then(() => true, () => false);
			await ctx.lock.release().catch(() => {});
			t3.equal(held, false);
		});
		t2.test("fails when the lock is held", async t3 => {
			const ctx = await makeConfig(t3);
			const other = new lib.LockFile(`${ctx.file}.lock`);
			await other.acquire();
			t3.teardown(() => other.release());
			await t3.rejects(
				run(ctx, "set", { field: "ctl.controller_url", value: "x" }),
				{ name: "LockFileExistsError" },
			);
			t3.equal(ctx.config.get("ctl.controller_url"), null);
		});
	});

	t1.test("does nothing for an unknown command", async t2 => {
		const ctx = await makeConfig(t2);
		const print = capturePrint(t2);
		await run(ctx, "frob");
		t2.strictSame(print(), []);
	});
});
