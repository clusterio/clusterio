import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import * as lib from "@clusterio/lib";
import "../setup_logging.js";

// Installation with dependencies installed from a path, an alias, git and the registry. Pinned
// installs and updates must not replace the ones not from the registry.
function useLocalDependencies() {
	const cwd = process.cwd();
	const dir = path.resolve("temp", "test", "rce_ops_local_dependency");
	const _fetch = global.fetch;
	before(async function() {
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: {
			"linked": "file:../linked",
			"aliased": "npm:other@^1.0.0",
			"from-git": "github:user/from-git",
			"published": "^1.0.0",
			"optional": "^1.0.0",
		}, optionalDependencies: {
			"optional": "github:user/optional",
		} }));
		process.chdir(dir);
		global.fetch = function() { return { ok: true }; };
	});
	after(function() {
		process.chdir(cwd);
		global.fetch = _fetch;
	});
	return dir;
}

describe("lib/rce_ops", function() {
	describe("updatePackage()", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.updatePackage("foo");
		});
	});

	describe("installPackage()", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.installPackage("foo");
		});

		describe("npm-operation.lock", function() {
			const lockPath = "npm-operation.lock";
			const inProgress = /Another package operation is already in progress/;
			const audit = lib.logger.audit;
			const recoveryPath = `${lockPath}.recovery`;
			afterEach(async function() {
				lib.logger.audit = audit;
				await fs.rm(lockPath, { force: true });
				await fs.rm(recoveryPath, { force: true });
			});

			it("rejects while another operation is in progress", async function() {
				let nested;
				lib.logger.audit = function() {
					lib.logger.audit = audit;
					nested = lib.installPackage("bar");
				};
				await lib.installPackage("foo");
				await assert.rejects(nested, inProgress);
				// The lock is released once the operation finishes
				await lib.installPackage("foo");
				await assert.rejects(fs.access(lockPath));
			});
			it("runs only one of several operations started together", async function() {
				const results = await Promise.allSettled([
					lib.installPackage("foo"), lib.updatePackage("bar"), lib.installPackage("baz"),
				]);
				assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected", "rejected"]);
				for (const result of results.slice(1)) {
					assert.match(result.reason.message, inProgress);
				}
			});
			it("holds the lock file while the operation runs", async function() {
				let lockContent;
				lib.logger.audit = function() {
					// eslint-disable-next-line node/no-sync
					lockContent = fsSync.readFileSync(lockPath, "utf8");
				};
				await lib.installPackage("foo");
				assert.equal(lockContent, `${process.pid} ${performance.timeOrigin}\n`);
				await assert.rejects(fs.access(lockPath));
			});
			it("releases the lock when the operation fails", async function() {
				lib.logger.audit = function() {
					throw new Error("operation failed");
				};
				await assert.rejects(lib.installPackage("foo"), /operation failed/);
				lib.logger.audit = audit;
				await assert.rejects(fs.access(lockPath));
				await lib.installPackage("foo");
			});
			it("leaves a lock it does not own in place", async function() {
				lib.logger.audit = function() {
					// eslint-disable-next-line node/no-sync
					fsSync.writeFileSync(lockPath, `${process.ppid}\n`);
				};
				await lib.installPackage("foo");
				assert.equal(await fs.readFile(lockPath, "utf8"), `${process.ppid}\n`);
			});
			it("rejects while another process holds the lock", async function() {
				// A standalone controller and host share the installation directory
				await fs.writeFile(lockPath, `${process.ppid}\n`);
				await assert.rejects(lib.installPackage("foo"), inProgress);
				assert.equal(await fs.readFile(lockPath, "utf8"), `${process.ppid}\n`);
			});
			it("rejects while another copy of lib in this process holds the lock", async function() {
				const rceOpsUrl = new URL("../../packages/lib/dist/node/src/rce_ops.js", import.meta.url);
				const otherCopy = await import(`${rceOpsUrl.href}?copy`);
				await lib.installPackage("foo", async () => {
					await assert.rejects(otherCopy.installPackage("bar"), inProgress);
				});
			});
			it("names the process holding the lock", async function() {
				await fs.writeFile(lockPath, `${process.ppid} 1234.5\n`);
				await assert.rejects(lib.installPackage("foo"), new RegExp(`held by process ${process.ppid}\\)`));
			});
			it("reports an interrupted recovery", async function() {
				await fs.writeFile(lockPath, "999999999\n");
				await fs.writeFile(recoveryPath, "999999999\n");
				await assert.rejects(lib.installPackage("foo"), /remove .*npm-operation\.lock\.recovery/);
			});
		});
	});

	describe("packageOperationRunning()", function() {
		const lockPath = "npm-operation.lock";
		const audit = lib.logger.audit;
		afterEach(async function() {
			lib.logger.audit = audit;
			await fs.rm(lockPath, { force: true });
		});

		it("reports whether an operation is running", async function() {
			assert.equal(await lib.packageOperationRunning(), false);
			let running;
			lib.logger.audit = function() {
				lib.logger.audit = audit;
				running = lib.packageOperationRunning();
			};
			await lib.installPackage("foo");
			assert.equal(await running, true);
			assert.equal(await lib.packageOperationRunning(), false);
			await fs.writeFile(lockPath, `${process.ppid}\n`);
			assert.equal(await lib.packageOperationRunning(), true);
			await fs.writeFile(lockPath, "999999999\n");
			assert.equal(await lib.packageOperationRunning(), false);
		});
	});

	describe("handleUpdateAll()", function() {
		it("updates the core package and all npm plugins in one command", async function() {
			const _audit = lib.logger.audit;
			const messages = [];
			lib.logger.audit = (msg) => { messages.push(msg); };
			try {
				await lib.handleUpdateAll("core", [{ npmPackage: "foo" }, { name: "local" }, { npmPackage: "bar" }]);
			} finally {
				lib.logger.audit = _audit;
			}
			assert.deepEqual(messages, ["RCE | npm update --save core foo bar"]);
		});
	});

	describe("handlePluginUpdate()", function() {
		it("runs", async function() {
			await lib.handlePluginUpdate("foo", [{ npmPackage: "foo" }]);
		});
		it("rejects when plugin not installed", async function() {
			await assert.rejects(
				lib.handlePluginUpdate("foo", []),
				/Plugin foo is not installed on this machine/
			);
			await assert.rejects(
				lib.handlePluginUpdate("foo@1.2.3", []),
				/Plugin foo is not installed on this machine/
			);
		});
		it("updates to a pinned version", async function() {
			const _fetch = global.fetch;
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};
			try {
				await lib.handlePluginUpdate("@scope/foo@1.2.3", [{ npmPackage: "@scope/foo" }]);
				assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo/1.2.3");
				global.fetch = function() { return { ok: false }; };
				await assert.rejects(
					lib.handlePluginUpdate("foo@9.9.9", [{ npmPackage: "foo" }]),
					/Unknown plugin: foo@9.9.9/,
				);
			} finally {
				global.fetch = _fetch;
			}
		});

		describe("over a dependency not from the registry", function() {
			const dir = useLocalDependencies();

			it("rejects pinned updates of dependencies not from the registry", async function() {
				for (const name of ["linked", "aliased", "from-git", "optional"]) {
					const error = new RegExp(`${name} is not installed from npm on this machine`);
					await assert.rejects(lib.handlePluginUpdate(`${name}@2.0.0`, [{ npmPackage: name }]), error);
				}
				await lib.handlePluginUpdate("published@2.0.0", [{ npmPackage: "published" }]);
			});
			it("rejects pinned updates of a plugin another plugin installs from git", async function() {
				const modules = path.join(dir, "node_modules");
				const plugin = (name, dependencies) => fs.mkdir(path.join(modules, name), { recursive: true })
					.then(() => fs.writeFile(path.join(modules, name, "package.json"), JSON.stringify({
						name, version: "1.0.0", keywords: ["clusterio-plugin"], dependencies,
					})));
				await plugin("published", { child: "github:user/child" });
				await plugin("child", {});
				try {
					await assert.rejects(
						lib.handlePluginUpdate("child@2.0.0", [{ npmPackage: "child" }]),
						/child is not installed from npm on this machine/,
					);
				} finally {
					await fs.rm(modules, { recursive: true, force: true });
				}
			});

			it("rejects pinned updates of a plugin an optional dependency installs from git", async function() {
				const modules = path.join(dir, "node_modules");
				const plugin = (name, packageJson) => fs.mkdir(path.join(modules, name), { recursive: true })
					.then(() => fs.writeFile(path.join(modules, name, "package.json"), JSON.stringify({
						name, version: "1.0.0", keywords: ["clusterio-plugin"], ...packageJson,
					})));
				await plugin("published", {
					dependencies: { child: "^1.0.0" },
					optionalDependencies: { child: "github:user/child" },
				});
				await plugin("child", {});
				try {
					await assert.rejects(
						lib.handlePluginUpdate("child@2.0.0", [{ npmPackage: "child" }]),
						/child is not installed from npm on this machine/,
					);
				} finally {
					await fs.rm(modules, { recursive: true, force: true });
				}
			});

			it("checks the source again once it holds the lock", async function() {
				const packageJsonPath = path.join(dir, "package.json");
				const original = await fs.readFile(packageJsonPath, "utf8");
				// Another operation switches it to git while the registry is being checked
				global.fetch = async function() {
					const packageJson = JSON.parse(original);
					packageJson.dependencies.published = "github:user/published";
					await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
					return { ok: true };
				};
				try {
					const error = /published is not installed from npm on this machine/;
					const update = lib.handlePluginUpdate("published@2.0.0", [{ npmPackage: "published" }]);
					await assert.rejects(update, error);
				} finally {
					global.fetch = function() { return { ok: true }; };
					await fs.writeFile(packageJsonPath, original);
				}
			});
		});
	});

	describe("handlePluginInstall()", function() {
		const _fetch = global.fetch;
		before(function() {
			global.fetch = function() { return { ok: false }; };
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("runs", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};

			await lib.handlePluginInstall("foo");
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});
		it("installs a pinned version", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};

			assert.equal(await lib.handlePluginInstall("foo@1.2.3"), "foo");
			assert.equal(calledWith, "https://registry.npmjs.com/foo/1.2.3");
			assert.equal(await lib.handlePluginInstall("@scope/foo@1.0.0-alpha.1"), "@scope/foo");
			assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo/1.0.0-alpha.1");
			await lib.handlePluginInstall("@scope/foo");
			assert.equal(calledWith, "https://registry.npmjs.com/@scope/foo");
		});
		it("rejects unregistered versions", async function() {
			global.fetch = function() { return { ok: false }; };
			await assert.rejects(lib.handlePluginInstall("foo@9.9.9"), /Unknown plugin: foo@9.9.9/);
		});
		it("rejects invalid versions", async function() {
			await assert.rejects(lib.handlePluginInstall("foo@"), /Invalid plugin version: /);
			await assert.rejects(lib.handlePluginInstall("foo@-1"), /Invalid plugin version: -1/);
		});
		it("rejects when name too long", async function() {
			const pluginName = "a".repeat(215);
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` }
			);
		});
		it("rejects specs npm would read as a path, repository or option", async function() {
			let fetched = false;
			global.fetch = function() {
				fetched = true;
				return { ok: true };
			};
			for (const spec of [
				".", "..", "./foo", "../foo", "foo/latest", "@clusterio/lib/latest", "-/ping", "-foo", ".foo",
				"_foo", "@scope", "@scope/", "@/foo", "@scope/foo/bar", "foo/bar@1.0.0", "github:foo/bar",
			]) {
				await assert.rejects(lib.handlePluginInstall(spec), /Invalid plugin name/, spec);
			}
			assert.equal(fetched, false);
		});
		it("rejects when invalid symbol present", async function() {
			const pluginName = "?";
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` },
			);
		});
		it("rejects unregistered packages", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: false };
			};

			await assert.rejects(lib.handlePluginInstall("foo"), /Unknown plugin: foo/);
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});

		describe("over a dependency not from the registry", function() {
			const dir = useLocalDependencies();

			it("rejects pinned installs of dependencies not from the registry", async function() {
				for (const name of ["linked", "aliased", "from-git", "optional"]) {
					const error = new RegExp(`${name} is not installed from npm on this machine`);
					await assert.rejects(lib.handlePluginInstall(`${name}@2.0.0`), error);
				}
				await lib.handlePluginInstall("published@2.0.0");
			});
			it("checks the source again once it holds the lock", async function() {
				const packageJsonPath = path.join(dir, "package.json");
				const original = await fs.readFile(packageJsonPath, "utf8");
				// Another operation switches it to git while the registry is being checked
				global.fetch = async function() {
					const packageJson = JSON.parse(original);
					packageJson.dependencies.published = "github:user/published";
					await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
					return { ok: true };
				};
				try {
					const error = /published is not installed from npm on this machine/;
					await assert.rejects(lib.handlePluginInstall("published@2.0.0"), error);
				} finally {
					global.fetch = function() { return { ok: true }; };
					await fs.writeFile(packageJsonPath, original);
				}
			});
		});
	});
});
