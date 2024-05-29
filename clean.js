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

const npmPackage = require("./package.json");
const workspaces = npmPackage.workspaces.map(p => p.slice(0, -2));

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

// Selection which type of clean to perform
if (process.argv.length > 2) {
	switch (process.argv[2]) {
		// Remove all artifacts
		case "all-dry":
			DRY = true;
		case "all": {
			removeBuildArtifacts();
			removeTestArtifacts();
			removeExecutionArtifacts();
			break;
		}

		// Remove all build and test artifacts
		case "tests-dry":
			DRY = true;
		case "tests": {
			removeBuildArtifacts();
			removeTestArtifacts();
			break;
		}

		// Remove all build artifacts
		case "fast-dry":
			DRY = true;
		case "fast": {
			removeBuildArtifacts();
			break;
		}

		default: {
			// eslint-disable-next-line no-console
			console.error("First argument must be one of: all, tests, fast, all-dry, tests-dry, fast-dry");
		}
	}
} else {
	removeBuildArtifacts();
}
