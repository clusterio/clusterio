import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import HostRecord from "@clusterio/controller/dist/node/src/HostRecord.js";
import { createLocalHost } from "../../packages/create/local_host.js";

describe("create/local_host createLocalHost()", function() {
	let directory;
	let secret;
	beforeEach(async function() {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-local-host-"));
		secret = crypto.randomBytes(256).toString("base64");
	});
	afterEach(async function() {
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 10 });
	});

	// Written with the controller's own config class to match its file format.
	async function writeControllerConfig(fields = {}) {
		const configPath = path.join(directory, "config-controller.json");
		const config = new lib.ControllerConfig("controller", undefined, configPath);
		config.set("controller.auth_secret", secret);
		for (const [name, value] of Object.entries(fields)) {
			config.set(name, value);
		}
		await config.save(true);
	}

	async function loadHosts(databaseDirectory = "database") {
		const provider = new lib.JsonIdDatastoreProvider(
			path.join(directory, databaseDirectory, "hosts.json"), HostRecord.fromJSON.bind(HostRecord),
		);
		return await provider.load();
	}

	it("adds a host the controller loads with a token it accepts", async function() {
		await writeControllerConfig();
		const before = Math.floor(Date.now() / 1000);
		const result = await createLocalHost({ directory, name: "local" });
		assert.equal(result.name, "local");
		assert(Number.isInteger(result.hostId) && result.hostId >= 1 && result.hostId < 2 ** 31);

		const hosts = await loadHosts();
		assert.deepEqual([...hosts.keys()], [result.hostId]);
		const record = hosts.get(result.hostId);
		assert.equal(record.name, "local");
		assert.equal(record.version, "");
		assert.deepEqual(record.plugins, new Map());
		assert(record.tokenValidAfter >= before);

		const payload = jwt.verify(result.token, Buffer.from(secret, "base64"), { audience: "host" });
		assert.equal(payload.host, result.hostId);
		assert(payload.iat >= record.tokenValidAfter, "token must not be issued before token_valid_after");
	});

	it("appends to an existing database in the configured directory", async function() {
		await writeControllerConfig({ "controller.database_directory": "db" });
		await fs.mkdir(path.join(directory, "db"));
		await fs.writeFile(path.join(directory, "db", "hosts.json"), JSON.stringify([
			{ id: 1, name: "existing", version: "2.0.0", plugins: {} },
		]));
		const result = await createLocalHost({ directory, name: "local", id: 7, version: "2.0.3" });
		assert.equal(result.hostId, 7);

		const hosts = await loadHosts("db");
		assert.deepEqual([...hosts.keys()], [1, 7]);
		assert.equal(hosts.get(1).name, "existing");
		assert.equal(hosts.get(7).version, "2.0.3");
		await assert.rejects(fs.access(path.join(directory, "database")), { code: "ENOENT" });
	});

	it("signs a new token for an existing host with the same id", async function() {
		await writeControllerConfig();
		const first = await createLocalHost({ directory, name: "first", id: 7 });
		const before = await fs.readFile(path.join(directory, "database", "hosts.json"), "utf8");
		const second = await createLocalHost({ directory, name: "second", id: 7 });
		assert.equal(second.hostId, 7);
		assert.equal(second.name, "first", "the name of the existing host should be kept");
		assert.equal(await fs.readFile(path.join(directory, "database", "hosts.json"), "utf8"), before);

		const record = (await loadHosts()).get(7);
		for (const token of [first.token, second.token]) {
			const payload = jwt.verify(token, Buffer.from(secret, "base64"), { audience: "host" });
			assert.equal(payload.host, 7);
			assert(payload.iat >= record.tokenValidAfter);
		}
	});

	it("throws if the controller config has no auth secret", async function() {
		await fs.writeFile(path.join(directory, "config-controller.json"), "{}");
		await assert.rejects(createLocalHost({ directory, name: "local" }), /controller\.auth_secret/);
	});
});
