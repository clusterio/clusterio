"use strict";
/**
 * Incorporate an external plugin into the pnpm workspace so it can be developed
 * against this repository with `--dev-plugin` (live web reloading).
 *
 * Usage:
 *   pnpm dev-plugin <path>          e.g. pnpm dev-plugin external_plugins/my-plugin
 *
 * Clone (or copy) the plugin's source directly into external_plugins/. This adds
 * one line to pnpm-workspace.yaml and runs `pnpm install`; pnpm then links the
 * plugin's dependencies to the workspace singletons, so no `injected: true` is
 * needed. Verified live: the controller builds and serves such a plugin via
 * --dev-plugin with no duplicate-dependency errors.
 *
 * Symlinking a plugin from OUTSIDE the repo is NOT supported: --dev-plugin builds
 * the plugin at its external_plugins/ path, which resolves the plugin's own
 * outside node_modules (duplicate react/webpack). `injected: true` does not change
 * that build path, so it does not help — the script refuses this case.
 *
 * Note: external_plugins/ is gitignored and pnpm-lock.yaml is committed, so the
 * resulting workspace/lockfile edits are local-only — do not commit them.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// realpath so the in-repo vs escapes-repo check below is not fooled by a
// symlinked/junctioned checkout (e.g. a git worktree).
const repoRoot = fs.realpathSync(__dirname);

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

const input = process.argv[2];
if (!input) {
	fail("usage: pnpm dev-plugin <path>   (e.g. external_plugins/my-plugin)");
}

const pluginDir = path.resolve(repoRoot, input);

let pkg;
try {
	pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
} catch (err) {
	fail(`no readable package.json at ${pluginDir} (${err.code || err.message})`);
}
if (!pkg.keywords || !pkg.keywords.includes("clusterio-plugin")) {
	fail(`${pkg.name || input} is missing the "clusterio-plugin" keyword — is it a Clusterio plugin?`);
}

// Workspace-relative POSIX path used in pnpm-workspace.yaml.
const relPath = path.relative(repoRoot, pluginDir).split(path.sep).join("/");
if (relPath.startsWith("..")) {
	fail(`${relPath} is outside the repository; place the plugin (or a symlink to it) under external_plugins/`);
}

// 1. Refuse a plugin whose real path is outside the repo. --dev-plugin builds the
// plugin at its external_plugins/ path, which resolves the plugin's OWN outside
// node_modules (duplicate react/webpack); injected:true does not change that build
// path, so symlinking from outside does not work. Copy the source in instead.
// Both paths are realpath'd, so the prefix check is robust — including a symlink to
// another drive on Windows, where path.relative() would return an absolute path.
const realDir = fs.realpathSync(pluginDir);
const escapesRepo = realDir !== repoRoot && !realDir.startsWith(repoRoot + path.sep);
if (escapesRepo) {
	console.error(`error: ${relPath} resolves to a path outside the repository:`);
	console.error(`  ${realDir}`);
	console.error("--dev-plugin builds the plugin there, against its own node_modules, which does");
	console.error("not work (injected:true does not fix it). Copy the plugin's source into");
	console.error("external_plugins/ instead of symlinking it.");
	process.exit(1);
}

// 2. Add the plugin to the `packages:` list in pnpm-workspace.yaml (idempotent).
const wsPath = path.join(repoRoot, "pnpm-workspace.yaml");
let ws = fs.readFileSync(wsPath, "utf8");
const entryRe = new RegExp(`^[ \\t]*-[ \\t]*${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t\\r]*$`, "m");
if (entryRe.test(ws)) {
	console.log(`pnpm-workspace.yaml already lists ${relPath}`);
} else {
	const packagesBlock = /^packages:\r?\n(?:[ \t]*-.*\r?\n)+/m;
	if (!packagesBlock.test(ws)) {
		fail("could not find a `packages:` list in pnpm-workspace.yaml");
	}
	ws = ws.replace(packagesBlock, block => `${block}  - ${relPath}\n`);
	fs.writeFileSync(wsPath, ws);
	console.log(`added ${relPath} to pnpm-workspace.yaml`);
}

// 3. Install: links the plugin's dependencies to the workspace singletons.
console.log(`Incorporating ${pkg.name}. Running pnpm install ...`);
execSync("pnpm install", { stdio: "inherit", cwd: repoRoot });
console.log("");

// The controller only discovers plugins under plugins/ and external_plugins/
// (lib/load_plugin_list.ts findLocalPlugins), so --dev-plugin can only load it
// live from one of those roots. Don't print a start command that won't work.
const topDir = relPath.split("/")[0];
if (topDir === "plugins" || topDir === "external_plugins") {
	// --dev-plugin takes the plugin's info name (its `plugin.name`), not the
	// package.json name. Read it now that the deps are installed.
	let pluginName;
	try {
		const info = require(pluginDir).plugin;
		pluginName = info && typeof info.name === "string" ? info.name : undefined;
	} catch (err) {
		console.log(`Installed, but could not read the plugin's info name (${err.message}).`);
		console.log("Once the workspace builds, start the controller with: --dev-plugin <plugin name>");
	}
	if (pluginName) {
		console.log(`Done. Start the controller with:  --dev-plugin ${pluginName}`);
	}
} else {
	console.log(`Done. ${relPath} is installed as a workspace member, but it is not under`);
	console.log("plugins/ or external_plugins/, so the controller will not auto-discover it for");
	console.log("--dev-plugin. Move it under external_plugins/ to run it live in a controller.");
}
