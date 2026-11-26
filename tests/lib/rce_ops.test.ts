import t from "tap";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import * as lib from "@clusterio/lib";

const rceOpsPath = "@clusterio/lib/dist/node/src/rce_ops.js";
const lockName = "npm-operation.lock";
const inProgress = /^Another package operation is already in progress on this machine/;
const ownContent = `${process.pid} ${performance.timeOrigin}\n`;
// The parent process (tap) is alive but isn't this process
const otherContent = `${process.ppid}\n`;
const exitedContent = "999999999\n";

// Run the test in a fresh working directory and record audit log messages
function setup(t1: any, files: Record<string, any> = {}) {
	const dir = t1.testdir(files);
	const cwd = process.cwd();
	process.chdir(dir);
	t1.teardown(() => process.chdir(cwd));
	const audits: string[] = [];
	t1.intercept(lib.logger, "audit", { value: (message: string) => { audits.push(message); } });
	return { dir, audits, lockPath: path.join(dir, lockName) };
}

// Stub fetch so registry lookups return ok, recording the urls requested
function stubRegistry(t1: any, ok = true) {
	const urls: string[] = [];
	t1.intercept(globalThis, "fetch", {
		value: async (url: string) => {
			urls.push(url);
			return { ok };
		},
	});
	return urls;
}

// Installation with dependencies from a path, an alias, git and the registry
const localDependencies = {
	"package.json": JSON.stringify({
		dependencies: {
			"linked": "file:../linked",
			"aliased": "npm:other@^1.0.0",
			"from-git": "github:user/from-git",
			"published": "^1.0.0",
			"optional": "^1.0.0",
		},
		optionalDependencies: {
			"optional": "github:user/optional",
		},
	}),
};

function pluginPackage(name: string, packageJson: object = {}) {
	return {
		"package.json": JSON.stringify({ name, version: "1.0.0", keywords: ["clusterio-plugin"], ...packageJson }),
	};
}

t.test("updatePackage()", async t1 => {
	t1.test("logs the npm update command", async t2 => {
		const { audits, lockPath } = setup(t2);
		await lib.updatePackage("foo", "bar");
		t2.strictSame(audits, ["RCE | npm update --save foo bar"]);
		await t2.rejects(fs.access(lockPath), { code: "ENOENT" });
	});
});

t.test("installPackage()", async t1 => {
	t1.test("logs the npm install command", async t2 => {
		const { audits } = setup(t2);
		await lib.installPackage("foo");
		t2.strictSame(audits, ["RCE | npm install --save foo"]);
	});
	t1.test("runs the command outside a development checkout", async t2 => {
		setup(t2);
		const commands: string[] = [];
		const audits: string[] = [];
		const { installPackage }: typeof lib = await t2.mockImport(rceOpsPath, {
			// The package path resolves through a symlink and does not match
			"../../packages/lib/dist/node/src/logging.js": {
				logger: { audit: (msg: string) => { audits.push(msg); } },
			},
			// Splitting on "/dist/" hides the packages directory from the dev check
			"path": { ...path, default: { ...path, sep: `${path.sep}dist${path.sep}` } },
			"child_process": {
				exec: (cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
					commands.push(cmd);
					callback(null, "", "");
				},
			},
		});
		await installPackage("foo");
		t2.strictSame(commands, ["npm install --save foo"]);
		t2.strictSame(audits, ["RCE | npm install --save foo"]);
	});
	t1.test("runs the check while holding the lock", async t2 => {
		const { audits, lockPath } = setup(t2);
		let lockContent;
		await lib.installPackage("foo", async () => {
			lockContent = await fs.readFile(lockPath, "utf8");
		});
		t2.equal(lockContent, ownContent);
		t2.strictSame(audits, ["RCE | npm install --save foo"]);
		await t2.rejects(fs.access(lockPath), { code: "ENOENT" });
	});
	t1.test("does not run the command when the check throws", async t2 => {
		const { audits, lockPath } = setup(t2);
		const error = new Error("check failed");
		await t2.rejects(lib.installPackage("foo", async () => { throw error; }), error);
		t2.strictSame(audits, []);
		await t2.rejects(fs.access(lockPath), { code: "ENOENT" });
	});
	t1.test("holds the lock file while the command runs", async t2 => {
		const { lockPath } = setup(t2);
		let lockContent;
		t2.intercept(lib.logger, "audit", {
			value: () => {
				// eslint-disable-next-line node/no-sync
				lockContent = fsSync.readFileSync(lockPath, "utf8");
			},
		});
		await lib.installPackage("foo");
		t2.equal(lockContent, ownContent);
		await t2.rejects(fs.access(lockPath), { code: "ENOENT" });
	});
	t1.test("releases the lock when the command fails", async t2 => {
		const { lockPath } = setup(t2);
		const error = new Error("operation failed");
		t2.intercept(lib.logger, "audit", { value: () => { throw error; } });
		await t2.rejects(lib.installPackage("foo"), error);
		await t2.rejects(fs.access(lockPath), { code: "ENOENT" });
		t2.equal(await lib.packageOperationRunning(), false);
	});
	t1.test("rejects while another operation is in progress", async t2 => {
		setup(t2);
		let nested: Promise<unknown> | undefined;
		await lib.installPackage("foo", async () => {
			nested = t2.rejects(lib.installPackage("bar"), { name: "ConflictError", message: inProgress });
		});
		await nested;
		// Released once the operation finishes
		await lib.installPackage("foo");
	});
	t1.test("runs only one of several operations started together", async t2 => {
		setup(t2);
		const results = await Promise.allSettled([
			lib.installPackage("foo"), lib.updatePackage("bar"), lib.installPackage("baz"),
		]);
		t2.strictSame(results.map(result => result.status), ["fulfilled", "rejected", "rejected"]);
		for (const result of results.slice(1)) {
			t2.match((result as PromiseRejectedResult).reason, { name: "ConflictError", message: inProgress });
		}
	});
	t1.test("leaves a lock it does not own in place", async t2 => {
		const { lockPath } = setup(t2);
		await lib.installPackage("foo", async () => {
			await fs.writeFile(lockPath, otherContent);
		});
		t2.equal(await fs.readFile(lockPath, "utf8"), otherContent);
	});
	t1.test("rejects while another process holds the lock", async t2 => {
		const { audits, lockPath } = setup(t2, { [lockName]: otherContent });
		await t2.rejects(lib.installPackage("foo"), new lib.ConflictError(
			"Another package operation is already in progress on this machine " +
			`(${lockPath} is held by process ${process.ppid})`,
		));
		t2.equal(await fs.readFile(lockPath, "utf8"), otherContent);
		t2.strictSame(audits, []);
		// The flag is cleared after a failed acquire
		await fs.rm(lockPath);
		await lib.installPackage("foo");
	});
	t1.test("does not name a holder when the lock has no pid", async t2 => {
		setup(t2, { [lockName]: "" });
		await t2.rejects(
			lib.installPackage("foo"),
			new lib.ConflictError("Another package operation is already in progress on this machine"),
		);
	});
	t1.test("rejects while another copy of lib in this process holds the lock", async t2 => {
		setup(t2);
		const otherCopy: typeof lib = await t2.mockImport(rceOpsPath, {});
		await lib.installPackage("foo", async () => {
			await t2.rejects(otherCopy.installPackage("bar"), { name: "ConflictError", message: inProgress });
		});
	});
	t1.test("rejects with UnavailableError after an interrupted recovery", async t2 => {
		const { lockPath } = setup(t2, { [lockName]: exitedContent, [`${lockName}.recovery`]: exitedContent });
		await t2.rejects(lib.installPackage("foo"), new lib.UnavailableError(
			`Lock file recovery was interrupted, remove ${lockPath}.recovery to allow the lock to be acquired`
		));
	});
	t1.test("passes on other errors acquiring the lock", async t2 => {
		setup(t2, { [lockName]: {} });
		await t2.rejects(lib.installPackage("foo"), { code: "EISDIR" });
		t2.equal(await lib.packageOperationRunning().catch(() => "rejected"), "rejected");
	});
});

t.test("packageOperationRunning()", async t1 => {
	t1.test("returns false when nothing is running", async t2 => {
		setup(t2);
		t2.equal(await lib.packageOperationRunning(), false);
	});
	t1.test("returns true while an operation runs in this process", async t2 => {
		setup(t2);
		let running: boolean | undefined;
		await lib.installPackage("foo", async () => {
			running = await lib.packageOperationRunning();
		});
		t2.equal(running, true);
		t2.equal(await lib.packageOperationRunning(), false);
	});
	t1.test("returns true while another process holds the lock", async t2 => {
		setup(t2, { [lockName]: otherContent });
		t2.equal(await lib.packageOperationRunning(), true);
	});
	t1.test("returns false for a lock left by an exited process", async t2 => {
		setup(t2, { [lockName]: exitedContent });
		t2.equal(await lib.packageOperationRunning(), false);
	});
});

t.test("handleUpdateAll()", async t1 => {
	t1.test("updates the core package and all npm plugins in one command", async t2 => {
		const { audits } = setup(t2);
		await lib.handleUpdateAll("core", [
			{ npmPackage: "foo" }, { name: "local" }, { npmPackage: "bar" },
		] as lib.PluginNodeEnvInfo[]);
		t2.strictSame(audits, ["RCE | npm update --save core foo bar"]);
	});
});

t.test("handlePluginUpdate()", async t1 => {
	const plugins = (...names: string[]) => names.map(npmPackage => ({ npmPackage })) as lib.PluginNodeEnvInfo[];

	t1.test("updates an installed plugin", async t2 => {
		const { audits } = setup(t2);
		const urls = stubRegistry(t2);
		await lib.handlePluginUpdate("foo", plugins("foo"));
		t2.strictSame(audits, ["RCE | npm update --save foo"]);
		t2.strictSame(urls, []);
	});
	t1.test("installs a pinned version", async t2 => {
		const { audits } = setup(t2);
		const urls = stubRegistry(t2);
		await lib.handlePluginUpdate("@scope/foo@1.2.3", plugins("@scope/foo"));
		t2.strictSame(urls, ["https://registry.npmjs.com/@scope/foo/1.2.3"]);
		t2.strictSame(audits, ["RCE | npm install --save @scope/foo@1.2.3"]);
	});
	t1.test("rejects a plugin that is not installed", async t2 => {
		setup(t2);
		for (const spec of ["foo", "foo@1.2.3"]) {
			await t2.rejects(
				lib.handlePluginUpdate(spec, plugins("bar")),
				new lib.NotFoundError("Plugin foo is not installed on this machine"),
			);
		}
	});
	t1.test("rejects a version not on the registry", async t2 => {
		const { audits } = setup(t2);
		stubRegistry(t2, false);
		await t2.rejects(
			lib.handlePluginUpdate("foo@9.9.9", plugins("foo")),
			new lib.NotFoundError("Unknown plugin: foo@9.9.9"),
		);
		t2.strictSame(audits, []);
	});
	t1.test("rejects pinned updates of dependencies not from the registry", async t2 => {
		const { audits } = setup(t2, localDependencies);
		stubRegistry(t2);
		for (const name of ["linked", "aliased", "from-git", "optional"]) {
			await t2.rejects(
				lib.handlePluginUpdate(`${name}@2.0.0`, plugins(name)),
				new lib.ConflictError(`${name} is not installed from npm on this machine`),
			);
		}
		t2.strictSame(audits, []);
		await lib.handlePluginUpdate("published@2.0.0", plugins("published"));
		t2.strictSame(audits, ["RCE | npm install --save published@2.0.0"]);
	});
	t1.test("rejects pinned updates of a plugin another plugin installs from git", async t2 => {
		setup(t2, {
			...localDependencies,
			"node_modules": {
				"published": pluginPackage("published", { dependencies: { child: "github:user/child" } }),
				"child": pluginPackage("child"),
			},
		});
		stubRegistry(t2);
		await t2.rejects(
			lib.handlePluginUpdate("child@2.0.0", plugins("child")),
			new lib.ConflictError("child is not installed from npm on this machine"),
		);
	});
	t1.test("rejects pinned updates of a plugin an optional dependency installs from git", async t2 => {
		setup(t2, {
			...localDependencies,
			"node_modules": {
				"published": pluginPackage("published", {
					dependencies: { child: "^1.0.0" },
					optionalDependencies: { child: "github:user/child" },
				}),
				"child": pluginPackage("child"),
			},
		});
		stubRegistry(t2);
		await t2.rejects(
			lib.handlePluginUpdate("child@2.0.0", plugins("child")),
			new lib.ConflictError("child is not installed from npm on this machine"),
		);
	});
	t1.test("allows pinned updates of a plugin installed from the registry", async t2 => {
		const { audits } = setup(t2, {
			...localDependencies,
			"node_modules": {
				"published": pluginPackage("published", { dependencies: { child: "^1.0.0" } }),
				"child": pluginPackage("child"),
			},
		});
		stubRegistry(t2);
		await lib.handlePluginUpdate("child@2.0.0", plugins("child"));
		t2.strictSame(audits, ["RCE | npm install --save child@2.0.0"]);
	});
	t1.test("checks the source again once it holds the lock", async t2 => {
		const { dir, audits } = setup(t2, localDependencies);
		// Another operation switches it to git while the registry is being checked
		t2.intercept(globalThis, "fetch", {
			value: async () => {
				const packageJson = JSON.parse(localDependencies["package.json"]);
				packageJson.dependencies.published = "github:user/published";
				await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(packageJson));
				return { ok: true };
			},
		});
		await t2.rejects(
			lib.handlePluginUpdate("published@2.0.0", plugins("published")),
			new lib.ConflictError("published is not installed from npm on this machine"),
		);
		t2.strictSame(audits, []);
	});
});

t.test("handlePluginInstall()", async t1 => {
	t1.test("installs the latest version and returns the name", async t2 => {
		const { audits } = setup(t2);
		const urls = stubRegistry(t2);
		t2.equal(await lib.handlePluginInstall("foo"), "foo");
		t2.strictSame(urls, ["https://registry.npmjs.com/foo"]);
		t2.strictSame(audits, ["RCE | npm install --save foo"]);
	});
	t1.test("installs a pinned version", async t2 => {
		const { audits } = setup(t2);
		const urls = stubRegistry(t2);
		t2.equal(await lib.handlePluginInstall("foo@1.2.3"), "foo");
		t2.equal(await lib.handlePluginInstall("@scope/foo@1.0.0-alpha.1"), "@scope/foo");
		t2.equal(await lib.handlePluginInstall("@scope/foo"), "@scope/foo");
		t2.strictSame(urls, [
			"https://registry.npmjs.com/foo/1.2.3",
			"https://registry.npmjs.com/@scope/foo/1.0.0-alpha.1",
			"https://registry.npmjs.com/@scope/foo",
		]);
		t2.strictSame(audits, [
			"RCE | npm install --save foo@1.2.3",
			"RCE | npm install --save @scope/foo@1.0.0-alpha.1",
			"RCE | npm install --save @scope/foo",
		]);
	});
	t1.test("rejects packages not on the registry", async t2 => {
		const { audits } = setup(t2);
		stubRegistry(t2, false);
		await t2.rejects(lib.handlePluginInstall("foo"), new lib.NotFoundError("Unknown plugin: foo"));
		await t2.rejects(lib.handlePluginInstall("foo@9.9.9"), new lib.NotFoundError("Unknown plugin: foo@9.9.9"));
		t2.strictSame(audits, []);
	});
	t1.test("rejects invalid versions", async t2 => {
		setup(t2);
		const urls = stubRegistry(t2);
		await t2.rejects(lib.handlePluginInstall("foo@"), new lib.ValidationError("Invalid plugin version: "));
		await t2.rejects(lib.handlePluginInstall("foo@-1"), new lib.ValidationError("Invalid plugin version: -1"));
		t2.strictSame(urls, []);
	});
	t1.test("rejects invalid names without looking them up", async t2 => {
		const { audits } = setup(t2);
		const urls = stubRegistry(t2);
		for (const spec of [
			"a".repeat(215), "?", ".", "..", "./foo", "../foo", "foo/latest", "@clusterio/lib/latest", "-/ping",
			"-foo", ".foo", "_foo", "@scope", "@scope/", "@/foo", "@scope/foo/bar", "foo/bar@1.0.0", "github:foo/bar",
		]) {
			await t2.rejects(
				lib.handlePluginInstall(spec),
				new lib.ValidationError(`Invalid plugin name: ${spec}`),
				spec,
			);
		}
		t2.strictSame(urls, []);
		t2.strictSame(audits, []);
	});
	t1.test("rejects pinned installs of dependencies not from the registry", async t2 => {
		const { audits } = setup(t2, localDependencies);
		stubRegistry(t2);
		for (const name of ["linked", "aliased", "from-git", "optional"]) {
			await t2.rejects(
				lib.handlePluginInstall(`${name}@2.0.0`),
				new lib.ConflictError(`${name} is not installed from npm on this machine`),
			);
		}
		t2.strictSame(audits, []);
		t2.equal(await lib.handlePluginInstall("published@2.0.0"), "published");
	});
	t1.test("checks the source again once it holds the lock", async t2 => {
		const { dir } = setup(t2, localDependencies);
		t2.intercept(globalThis, "fetch", {
			value: async () => {
				const packageJson = JSON.parse(localDependencies["package.json"]);
				packageJson.dependencies.published = "github:user/published";
				await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(packageJson));
				return { ok: true };
			},
		});
		await t2.rejects(
			lib.handlePluginInstall("published@2.0.0"),
			new lib.ConflictError("published is not installed from npm on this machine"),
		);
	});
});
