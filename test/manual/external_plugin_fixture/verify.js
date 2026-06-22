"use strict";
/*
 * Reproduction driver for PR #922 — run AFTER wiring this fixture into the
 * workspace (see README.md). It faithfully replicates the resolution mechanics
 * of the controller's --dev-plugin flag (Controller.ts `_startDevServer`):
 *
 *   - the controller requires ITS OWN webpack and runs it,
 *   - over the config returned by this plugin's webpack.config.js, whose own
 *     require("webpack") supplies the ModuleFederationPlugin.
 *
 * It does NOT exercise controller plugin *discovery* (that only scans plugins/
 * and external_plugins/, never test/) — this validates the build/resolution
 * claim directly. To boot the plugin in a live controller, see README.md.
 *
 * Checks:
 *   1. react resolves to ONE copy, shared with @clusterio/web_ui (dedup).
 *   2. react-dom resolves to ONE copy, shared with @clusterio/web_ui (dedup).
 *   3. the controller's webpack and the plugin's webpack are the SAME copy
 *      (the build-tool singleton injected:true is meant to guarantee).
 *   4. the web bundle compiles with no errors.
 *
 * react / react-dom are Module-Federation shared with import:false, so they are
 * not bundled; checks 1-2 (not the compile) are what prove single-copy sharing.
 *
 * The fixture deliberately requests react@^17 and webpack@^4 — a PASS shows the
 * root pnpm.overrides collapsed those to the workspace react@18 / webpack@5.
 * react-dom is requested as ^18.2.0 (a compatible range, NOT overridden), so
 * check 2 confirms it dedupes to the workspace copy on its own.
 */
const path = require("path");
const { createRequire } = require("module");

const fixtureDir = __dirname;
const repoRoot = path.resolve(fixtureDir, "..", "..", "..");

function requireFrom(dir) {
	return createRequire(path.join(dir, "noop.js"));
}

const results = [];
function check(label, pass, detail) {
	results.push(pass);
	console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
	if (detail) {
		console.log(`        ${detail}`);
	}
}

function short(p) {
	return p ? p.replace(repoRoot, "<repo>") : "(unresolved)";
}

function versionOf(req, name) {
	try {
		return req(`${name}/package.json`).version;
	} catch (err) {
		return "(unresolved)";
	}
}

console.log("Reproduction: external plugin as an in-repo workspace member, NO injected:true\n");

const fixtureReq = requireFrom(fixtureDir);
const webUiReq = requireFrom(path.join(repoRoot, "packages", "web_ui"));
const controllerReq = requireFrom(path.join(repoRoot, "packages", "controller"));

// The fixture asks for react ^17 / webpack ^4 (overridden) and react-dom ^18.2.0
// (deduped); show what they actually resolved to.
console.log("Resolved versions (requested: react ^17, webpack ^4 — overridden; react-dom ^18.2.0 — deduped):");
console.log(`  react      ${versionOf(fixtureReq, "react")}`);
console.log(`  react-dom  ${versionOf(fixtureReq, "react-dom")}`);
console.log(`  webpack    ${versionOf(fixtureReq, "webpack")}\n`);

// --- 1. single react shared with the host (web_ui) ---
check(
	"react resolves to a single copy shared with @clusterio/web_ui",
	fixtureReq.resolve("react") === webUiReq.resolve("react"),
	`fixture: ${short(fixtureReq.resolve("react"))}\n        web_ui:  ${short(webUiReq.resolve("react"))}`
);

// --- 2. single react-dom shared with the host (web_ui) ---
check(
	"react-dom resolves to a single copy shared with @clusterio/web_ui",
	fixtureReq.resolve("react-dom") === webUiReq.resolve("react-dom"),
	`fixture: ${short(fixtureReq.resolve("react-dom"))}\n        web_ui:  ${short(webUiReq.resolve("react-dom"))}`
);

// --- 3. controller webpack === plugin webpack (the guarantee injection is for) ---
check(
	"controller webpack and plugin webpack are the same copy",
	controllerReq.resolve("webpack") === fixtureReq.resolve("webpack"),
	`controller: ${short(controllerReq.resolve("webpack"))}\n        plugin:     ${short(fixtureReq.resolve("webpack"))}`
);

// --- 4. the --dev-plugin build compiles clean ---
// Constructing the config can THROW before the build runs: with the overrides
// removed the fixture resolves webpack@4, whose `webpack.container` is undefined,
// so webpack.config.js throws a TypeError. Catch it so the summary still prints.
function runBuild() {
	return new Promise(resolve => {
		let webpack;
		let config;
		try {
			webpack = controllerReq("webpack"); // W1: controller's webpack, as _startDevServer does
			config = require(path.join(fixtureDir, "webpack.config"))({}); // inner require("webpack") = W2
		} catch (err) {
			resolve({
				ok: false,
				detail: `building the config threw before compile: ${err.message}\n`
					+ "        (expected with the overrides removed — webpack 4 has no "
					+ "webpack.container.ModuleFederationPlugin)",
			});
			return;
		}
		webpack([config]).run((err, stats) => {
			if (err) {
				resolve({ ok: false, detail: String(err) });
			} else if (stats.hasErrors()) {
				resolve({ ok: false, detail: stats.toString({ colors: false, modules: false, errorDetails: true }) });
			} else {
				resolve({ ok: true });
			}
		});
	});
}

runBuild().then(build => {
	check("--dev-plugin web build compiles with no errors", build.ok, build.ok ? undefined : build.detail);
	const passed = results.every(Boolean);
	console.log(`\n${passed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
	console.log("(remove the `react` / `webpack` lines from pnpm.overrides, re-run `pnpm install`,");
	console.log(" and re-run this script to watch the checks fail)");
	process.exit(passed ? 0 : 1);
});
