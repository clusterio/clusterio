/**
 * Clean the repository of build and execution artifacts.
 *
 * clean: A quick clean that removes all build artifacts making the output safe to publish
 * clean-tests: Removes all build and test artifacts should not be required if tests are setup correctly.
 * clean-all: Removes all build, test, and execution artifacts. Including cluster config and logs!
 */

"use strict";
const path = require("path");
const fs = require("fs-extra");
const yargs = require("yargs");

const npmPackage = require("./package.json");
const workspaces = npmPackage.workspaces
	.map(p => p.slice(0, -2))
	.filter(p => !p.includes("external_plugins"));

let DRY = false;

/**
 * Attempt to remove a file / directory if it exists.
 *
 * @param {string} filePath The path to remove.
 */
async function tryRemove(filePath) {
	if (await fs.exists(filePath)) {
		// eslint-disable-next-line no-console
		console.log(filePath);
	}

	if (!DRY) {
		await fs.remove(filePath);
	}
}

/**
 * Removes all build artifacts
 */
async function removeBuildArtifacts() {
	const tasks = [];

	for (const workspace of workspaces) {
		const basePath = path.resolve(workspace);
		const packages = await fs.readdir(basePath);
		for (const packageName of packages) {
			tasks.push(
				tryRemove(path.join(basePath, packageName, "dist"))
			);
			tasks.push(
				tryRemove(path.join(basePath, packageName, "node_modules", ".cache"))
			);
		}
	}

	await Promise.all(tasks);
}

/**
 * Removes all test artifacts
 */
async function removeTestArtifacts() {
	const artifacts = [
		".nyc_output", "coverage", "temp", "static",
	];

	await Promise.all(artifacts.map(artifact => tryRemove(path.resolve(artifact))));
}

/**
 * Removes all execution artifacts
 */
async function removeExecutionArtifacts() {
	const artifacts = [
		"database", "instances", "logs", "mods",
		"config-control.json", "config-controller.json", "config-host.json",
		"FactorioAdminToken.txt", "plugin-list.json",
	];

	await Promise.all(artifacts.map(artifact => tryRemove(path.resolve(artifact))));
}

/**
 * Main function for this script
 */
async function main() {
	await yargs(process.argv.slice(2))
		.scriptName("clean")
		.usage("$0 <command> [options]")
		.option("dry", {
			nargs: 0,
			describe: "Will not delete any files",
			default: false,
			type: "boolean",
		})
		.command("all", "Remove all artifacts", () => {}, argv => {
			DRY = argv.dry;
			removeBuildArtifacts();
			removeTestArtifacts();
			removeExecutionArtifacts();
		})
		.command("tests", "Remove all build and test artifacts", () => {}, argv => {
			DRY = argv.dry;
			removeBuildArtifacts();
			removeTestArtifacts();
		})
		.command("fast", "Remove all build artifacts", () => {}, argv => {
			DRY = argv.dry;
			removeBuildArtifacts();
		})
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.parse();
}

// Run main if started from command line
if (module === require.main) {
	main();
}
