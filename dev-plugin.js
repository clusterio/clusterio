"use strict";
/**
 * Incorporate an external plugin into the pnpm workspace so it can be developed
 * against this repository with `--dev-plugin` (live web reloading).
 *
 * Usage:
 *   pnpm dev-plugin <path>          e.g. pnpm dev-plugin external_plugins/my-plugin
 *
 * For a plugin cloned/copied directly into the repo this adds one line to
 * pnpm-workspace.yaml and runs `pnpm install` — pnpm then links the plugin's
 * dependencies to the workspace singletons, so no `injected: true` is needed.
 * If the plugin is a symlink pointing OUTSIDE the repo, its real path escapes
 * the workspace and you additionally need `injected: true`; the script detects
 * this and prints the snippet to add rather than editing package.json for you.
 *
 * Note: external_plugins/ is gitignored and pnpm-lock.yaml is committed, so the
 * resulting lockfile/workspace edits are local-only — do not commit them.
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

// 1. Add the plugin to the `packages:` list in pnpm-workspace.yaml (idempotent).
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

// 2. Injection is only needed when the real path escapes the repo (symlinked in).
const realDir = fs.realpathSync(pluginDir);
const escapesRepo = path.relative(repoRoot, realDir).startsWith("..");
if (escapesRepo) {
	console.log("");
	console.log(`${pkg.name} is symlinked from outside the repo:`);
	console.log(`  ${realDir}`);
	console.log("Its dependencies resolve to its own node_modules, so you also need `injected: true`.");
	console.log("Add this to the root package.json, then run `pnpm install`:");
	console.log("");
	console.log(`  "devDependencies":   { "${pkg.name}": "workspace:*" }`);
	console.log(`  "dependenciesMeta":  { "${pkg.name}": { "injected": true } }`);
	console.log("");
	console.log("(Skipping automatic install — add the snippet above first.)");
	process.exit(0);
}

// 3. In-repo plugin: install is all that's left.
console.log(`${pkg.name} lives inside the repo — no injection needed. Running pnpm install ...`);
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
