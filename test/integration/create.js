"use strict";
const assert = require("assert").strict;
const fs = require("node:fs/promises");
const jwt = require("jsonwebtoken");
const path = require("path");
const events = require("events");
const child_process = require("child_process");
const util = require("util");

const cwd = path.join("temp", "test_integration");

async function exec(command, options = {}) {
	// Uncomment to show commands run in tests
	// console.log(command);
	options = { cwd, ...options };
	return await util.promisify(child_process.exec)(command, options);
}

describe("Integration of create tool", function () {
	beforeEach(async function () {
		await fs.mkdir(cwd, { recursive: true });
	});
	afterEach(async function () {
		await fs.rm(cwd, { recursive: true, maxRetries: 10 });
	});
	it("should create a new standalone installation", async function () {
		this.skip();
		await exec([
			"node ../../packages/create",
			"--mode standalone",
			"--admin Danielv123",
			"--http-port 8099",
			"--host-name localhost",
			"--public-address localhost",
			"--factorio-dir test/factorio",
			"--plugins --",
		].join(" "));

		// Check that the generated config is correct
		const controllerConfig = JSON.parse(await fs.readFile(path.join(cwd, "config-controller.json")));
		assert.equal(controllerConfig["controller.http_port"], 8099);

		const hostConfig = JSON.parse(await fs.readFile(path.join(cwd, "config-host.json")));
		assert.equal(hostConfig["host.name"], "local");
		assert.equal(hostConfig["host.public_address"], "localhost");
		assert.equal(hostConfig["host.factorio_directory"], "test/factorio");
		assert.equal(hostConfig["host.controller_url"], "http://localhost:8099/");
	}).timeout(1200000);
	it("should create a new controller installation", async function () {
		this.skip();
		await exec([
			"node ../../packages/create",
			"--mode controller",
			"--admin Danielv123",
			"--http-port 8099",
			"--public-address localhost",
			"--plugins --",
		].join(" "));

		// Check that the generated config is correct
		const controllerConfig = JSON.parse(await fs.readFile(path.join(cwd, "config-controller.json")));
		assert.equal(controllerConfig["controller.http_port"], 8099);

		await assert.rejects(fs.access(path.join(cwd, "config-host.json")));
	}).timeout(60000);
});
