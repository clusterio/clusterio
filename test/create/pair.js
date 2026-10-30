import assert from "node:assert/strict";
import crypto from "node:crypto";
import events from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import jwt from "jsonwebtoken";

import * as lib from "@clusterio/lib";
import HostRecord from "@clusterio/controller/dist/node/src/HostRecord.js";
import {
	PairingError, checkHostToken, createLocalHost, pairHost,
} from "../../packages/create/pair.js";

import "../setup_logging.js";

const tlsDir = path.join(import.meta.dirname, "..", "file", "tls");

// Stub controller recording requests, responding with what the test's handler returns.
async function startStub(createServer = http.createServer) {
	const stub = {
		requests: [],
		handler: () => [500, { error: "No handler" }],
	};
	stub.server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const entry = {
			method: req.method,
			url: req.url,
			headers: req.headers,
			body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined,
		};
		stub.requests.push(entry);
		const [status, json, headers = {}] = await stub.handler(entry);
		res.writeHead(status, { "Content-Type": "application/json", ...headers });
		res.end(json === undefined ? undefined : JSON.stringify(json));
	});
	stub.server.listen(0, "localhost");
	await events.once(stub.server, "listening");
	stub.url = `${stub.server instanceof https.Server ? "https" : "http"}://localhost:${stub.server.address().port}/`;
	stub.close = async () => {
		stub.server.closeAllConnections();
		stub.server.close();
		await events.once(stub.server, "close");
	};
	return stub;
}

// Handler for a request that is approved after the given number of pending polls.
function approveAfter(polls, result = { hostId: 1234, token: "host-token", name: "Approved" }) {
	let pending = 0;
	return ({ url }) => {
		if (url === "/api/host-pairing") {
			return [202, { requestId: "secret", code: "ABC-DEF" }];
		}
		if (url === "/api/host-pairing/poll") {
			pending += 1;
			return pending > polls ? [200, result] : [202, { status: "pending" }];
		}
		return [404, { error: "Not found" }];
	};
}

describe("create/pair", function() {
	let stub;
	beforeEach(async function() {
		stub = await startStub();
	});
	afterEach(async function() {
		await stub.close();
	});

	describe("pairHost()", function() {
		it("returns the host when approved with a user token", async function() {
			stub.handler = () => [200, { hostId: 5, token: "host-token", name: "Host" }];
			let pendingCalls = 0;
			const result = await pairHost({
				controllerUrl: stub.url, name: "Host", version: "2.0.3", token: "user-token",
				onPending: () => { pendingCalls += 1; },
			});
			assert.deepEqual(result, { hostId: 5, token: "host-token", name: "Host" });
			assert.equal(pendingCalls, 0);
			assert.equal(stub.requests.length, 1);
			const [created] = stub.requests;
			assert.equal(created.method, "POST");
			assert.equal(created.url, "/api/host-pairing");
			assert.equal(created.headers.authorization, "Bearer user-token");
			assert.deepEqual(created.body, { name: "Host", version: "2.0.3" });
		});

		it("polls until the request is approved", async function() {
			stub.handler = approveAfter(2);
			const codes = [];
			const result = await pairHost({
				controllerUrl: stub.url, name: "Host", pollIntervalMs: 10,
				onPending: ({ code }) => { codes.push(code); },
			});
			assert.deepEqual(result, { hostId: 1234, token: "host-token", name: "Approved" });
			assert.deepEqual(codes, ["ABC-DEF"]);
			assert.deepEqual(stub.requests.map(r => r.url), [
				"/api/host-pairing", "/api/host-pairing/poll", "/api/host-pairing/poll", "/api/host-pairing/poll",
			]);
			assert.equal(stub.requests[0].headers.authorization, undefined);
			assert.deepEqual(stub.requests[0].body, { name: "Host", version: "" });
			for (const poll of stub.requests.slice(1)) {
				assert.deepEqual(poll.body, { requestId: "secret" });
			}
		});

		["sub", "sub/"].forEach(controllerPath => {
			it(`resolves routes under a controller URL ending in ${controllerPath}`, async function() {
				stub.handler = ({ url }) => (url === "/sub/api/host-pairing"
					? [200, { hostId: 5, token: "host-token", name: "Host" }]
					: [404, {}]
				);
				const result = await pairHost({ controllerUrl: `${stub.url}${controllerPath}`, name: "Host" });
				assert.equal(result.hostId, 5);
			});
		});

		it("throws the error from the controller when the request is rejected", async function() {
			const handler = approveAfter(1);
			stub.handler = entry => {
				if (entry.url === "/api/host-pairing/poll" && stub.requests.length > 2) {
					return [403, { error: "Request was rejected" }];
				}
				return handler(entry);
			};
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host", pollIntervalMs: 10 }),
				err => err instanceof PairingError && err.status === 403 && err.message === "Request was rejected",
			);
		});

		it("throws if the controller does not support pairing", async function() {
			stub.handler = () => [404, undefined];
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host" }),
				err => err instanceof PairingError && err.status === 404 && /must be updated/.test(err.message),
			);
		});

		it("throws on an invalid user token", async function() {
			stub.handler = () => [401, { error: "Invalid user token" }];
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host", token: "bad", onPending: () => assert.fail() }),
				err => err instanceof PairingError && err.status === 401 && err.message === "Invalid user token",
			);
			assert.equal(stub.requests.length, 1);
		});

		it("includes the retry time when rate limited", async function() {
			stub.handler = () => [429, { error: "Too many requests from this address" }, { "Retry-After": "42" }];
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host" }),
				err => err instanceof PairingError && err.status === 429 && /try again in 42 seconds/.test(err.message),
			);
		});

		it("throws if the request expired", async function() {
			const handler = approveAfter(0);
			stub.handler = entry => (entry.url === "/api/host-pairing/poll"
				? [404, { error: "Request not found" }]
				: handler(entry)
			);
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host", pollIntervalMs: 10 }),
				err => err instanceof PairingError && err.status === 404 && err.message === "Request not found",
			);
		});

		it("cancels the request when aborted", async function() {
			const controller = new AbortController();
			stub.handler = entry => {
				if (entry.url === "/api/host-pairing/poll") {
					controller.abort();
				}
				if (entry.url === "/api/host-pairing/cancel") {
					return [204, undefined];
				}
				return approveAfter(Infinity)(entry);
			};
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host", pollIntervalMs: 10, signal: controller.signal }),
				{ name: "AbortError" },
			);
			const cancel = stub.requests.find(r => r.url === "/api/host-pairing/cancel");
			assert.deepEqual(cancel?.body, { requestId: "secret" });
		});

		it("does not send anything if already aborted", async function() {
			await assert.rejects(
				pairHost({ controllerUrl: stub.url, name: "Host", signal: AbortSignal.abort() }),
				{ name: "AbortError" },
			);
			assert.equal(stub.requests.length, 0);
		});

		it("throws on invalid controller URLs", async function() {
			for (const controllerUrl of ["localhost:8080", "ftp://localhost/", "not a url"]) {
				await assert.rejects(pairHost({ controllerUrl, name: "Host" }), PairingError);
			}
		});

		it("trusts the certificate passed as ca", async function() {
			const [key, cert] = await Promise.all([
				fs.readFile(path.join(tlsDir, "key.pem")),
				fs.readFile(path.join(tlsDir, "cert.pem")),
			]);
			const httpsStub = await startStub(handler => https.createServer({ key, cert }, handler));
			try {
				httpsStub.handler = () => [200, { hostId: 5, token: "host-token", name: "Host" }];
				const result = await pairHost({ controllerUrl: httpsStub.url, name: "Host", ca: cert });
				assert.equal(result.hostId, 5);

				// Passing a different certificate replaces the trusted ones, proving ca is used.
				await assert.rejects(
					pairHost({ controllerUrl: httpsStub.url, name: "Host", ca: tls.rootCertificates[0] }),
					err => typeof err.code === "string" && !(err instanceof PairingError),
				);
			} finally {
				await httpsStub.close();
			}
		});
	});

	describe("checkHostToken()", function() {
		it("returns true if the controller accepts the token", async function() {
			stub.handler = () => [200, { valid: true }];
			assert.equal(await checkHostToken({ controllerUrl: stub.url, token: "host-token" }), true);
			assert.equal(stub.requests[0].method, "GET");
			assert.equal(stub.requests[0].url, "/api/host-pairing/check");
			assert.equal(stub.requests[0].headers.authorization, "Bearer host-token");
		});

		it("returns false if the controller does not accept the token", async function() {
			stub.handler = () => [401, undefined];
			assert.equal(await checkHostToken({ controllerUrl: stub.url, token: "host-token" }), false);
		});

		it("throws on other responses", async function() {
			stub.handler = () => [503, { error: "Controller is in recovery mode" }];
			await assert.rejects(
				checkHostToken({ controllerUrl: stub.url, token: "host-token" }),
				err => err instanceof PairingError && err.status === 503,
			);
		});
	});
});

describe("create/pair createLocalHost()", function() {
	let directory;
	let secret;
	beforeEach(async function() {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-pair-"));
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
