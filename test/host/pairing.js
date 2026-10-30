import assert from "node:assert/strict";
import events from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { PairingError, checkHostToken, pairHost } from "@clusterio/host";
import { ensurePaired } from "@clusterio/host/dist/node/src/pairing.js";

import "../setup_logging.js";

// Stub controller recording requests, responding with what the test's handler returns.
async function startStub() {
	const stub = {
		requests: [],
		handler: () => [500, { error: "No handler" }],
	};
	stub.server = http.createServer(async (req, res) => {
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
	stub.server.listen(0, "127.0.0.1");
	await events.once(stub.server, "listening");
	stub.url = `http://127.0.0.1:${stub.server.address().port}/`;
	stub.close = async () => {
		stub.server.closeAllConnections();
		stub.server.close();
		await events.once(stub.server, "close");
	};
	return stub;
}

const approved = { hostId: 1234, token: "host-token", name: "Approved" };

// Handler for requests that are approved after the given number of pending polls.
function approveAfter(polls, result = approved) {
	let pending = 0;
	let requests = 0;
	return ({ url }) => {
		if (url === "/api/host-pairing") {
			requests += 1;
			return [202, { requestId: `secret-${requests}`, code: `ABC-DE${requests}` }];
		}
		if (url === "/api/host-pairing/poll") {
			pending += 1;
			return pending > polls ? [200, result] : [202, { status: "pending" }];
		}
		if (url === "/api/host-pairing/cancel") {
			return [204, undefined];
		}
		return [404, { error: "Not found" }];
	};
}

describe("host/src/pairing", function() {
	let stub;
	beforeEach(async function() {
		stub = await startStub();
	});
	afterEach(async function() {
		await stub.close();
	});

	function pair(options = {}) {
		return pairHost({ controllerUrl: stub.url, name: "Host", pollIntervalMs: 10, retryDelayMs: 10, ...options });
	}

	describe("pairHost()", function() {
		it("returns the host when approved with a user token", async function() {
			stub.handler = ({ headers }) => (headers.authorization === "Bearer user-token"
				? [200, approved]
				: [401, { error: "Invalid user token" }]
			);
			const result = await pair({ token: "user-token", onPending: () => assert.fail("should not wait") });
			assert.deepEqual(result, approved);
			assert.equal(stub.requests.length, 1);
		});

		it("polls until the request is approved", async function() {
			stub.handler = approveAfter(2);
			const codes = [];
			const result = await pair({ version: "2.1.0", onPending: code => { codes.push(code); } });
			assert.deepEqual(result, approved);
			assert.deepEqual(codes, ["ABC-DE1"]);
			assert.deepEqual(stub.requests[0].body, { name: "Host", version: "2.1.0" });
			assert.equal(stub.requests[0].headers.authorization, undefined);
			for (const poll of stub.requests.slice(1)) {
				assert.deepEqual(poll.body, { requestId: "secret-1" });
			}
		});

		it("resolves routes under the path of the controller URL", async function() {
			stub.handler = ({ url }) => (url === "/sub/api/host-pairing" ? [200, approved] : [404, {}]);
			const result = await pair({ controllerUrl: `${stub.url}sub/` });
			assert.equal(result.hostId, 1234);
		});

		it("makes a new request when the previous one expired", async function() {
			const handler = approveAfter(0);
			let expired = false;
			stub.handler = entry => {
				if (entry.url === "/api/host-pairing/poll" && !expired) {
					expired = true;
					return [404, { error: "Request not found" }];
				}
				return handler(entry);
			};
			const codes = [];
			const result = await pair({ onPending: code => { codes.push(code); } });
			assert.deepEqual(result, approved);
			assert.deepEqual(codes, ["ABC-DE1", "ABC-DE2"]);
		});

		it("waits and tries again when the controller is busy", async function() {
			const handler = approveAfter(0);
			let busy = 2;
			stub.handler = entry => {
				if (entry.url === "/api/host-pairing" && busy > 0) {
					busy -= 1;
					return busy ? [429, { error: "Too many requests" }] : [503, { error: "Recovery mode" }];
				}
				return handler(entry);
			};
			const retries = [];
			const result = await pair({ onRetry: err => { retries.push(err.message); } });
			assert.deepEqual(result, approved);
			assert.deepEqual(retries, ["Too many requests", "Recovery mode"]);
		});

		it("keeps trying while the controller can't be reached", async function() {
			const { url } = stub;
			await stub.close();
			const abort = new AbortController();
			const errors = [];
			await assert.rejects(
				pairHost({
					controllerUrl: url, name: "Host", retryDelayMs: 10, signal: abort.signal,
					onRetry: err => {
						errors.push(err);
						if (errors.length === 3) {
							abort.abort();
						}
					},
				}),
				{ name: "AbortError" },
			);
			assert.equal(errors.length, 3);
			stub = await startStub();
		});

		it("throws when the request is rejected", async function() {
			const handler = approveAfter(Infinity);
			stub.handler = entry => (entry.url === "/api/host-pairing/poll" && stub.requests.length > 2
				? [403, { error: "Request was rejected" }]
				: handler(entry)
			);
			await assert.rejects(
				pair(),
				err => err instanceof PairingError && err.status === 403 && err.message === "Request was rejected",
			);
		});

		it("throws if the controller does not support pairing", async function() {
			stub.handler = () => [404, undefined];
			await assert.rejects(
				pair(),
				err => err instanceof PairingError && err.status === 404 && /must be updated/.test(err.message),
			);
		});

		it("throws on an invalid user token without waiting", async function() {
			stub.handler = () => [401, { error: "Invalid user token" }];
			await assert.rejects(
				pair({ token: "bad" }),
				err => err instanceof PairingError && err.status === 401 && err.message === "Invalid user token",
			);
			assert.equal(stub.requests.length, 1);
		});

		it("cancels the request when aborted", async function() {
			const abort = new AbortController();
			const handler = approveAfter(Infinity);
			stub.handler = entry => {
				if (entry.url === "/api/host-pairing/poll") {
					abort.abort();
				}
				return handler(entry);
			};
			await assert.rejects(pair({ signal: abort.signal }), { name: "AbortError" });
			const cancel = stub.requests.find(r => r.url === "/api/host-pairing/cancel");
			assert.deepEqual(cancel?.body, { requestId: "secret-1" });
		});

		it("does not send anything if already aborted", async function() {
			await assert.rejects(pair({ signal: AbortSignal.abort() }), { name: "AbortError" });
			assert.equal(stub.requests.length, 0);
		});
	});

	describe("checkHostToken()", function() {
		it("returns true if the controller accepts the token", async function() {
			stub.handler = ({ url, headers }) => (
				url === "/api/host-pairing/check" && headers.authorization === "Bearer host-token"
					? [200, { valid: true }]
					: [401, undefined]
			);
			assert.equal(await checkHostToken(stub.url, "host-token"), true);
			assert.equal(await checkHostToken(stub.url, "other-token"), false);
		});

		it("throws on other responses", async function() {
			stub.handler = () => [404, undefined];
			await assert.rejects(checkHostToken(stub.url, "host-token"), PairingError);
		});
	});

	describe("ensurePaired()", function() {
		let directory;
		let config;
		beforeEach(async function() {
			directory = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-pairing-"));
			config = new lib.HostConfig("host", undefined, path.join(directory, "config-host.json"));
			config.set("host.name", "My Host");
			config.set("host.controller_url", stub.url);
		});
		afterEach(async function() {
			await fs.rm(directory, { recursive: true, force: true, maxRetries: 10 });
		});

		async function savedConfig() {
			return JSON.parse(await fs.readFile(path.join(directory, "config-host.json"), "utf8"));
		}

		it("waits for approval and saves the host when not paired", async function() {
			this.timeout(5000); // Polls at the default interval of 2 seconds
			stub.handler = approveAfter(0);
			await ensurePaired(config, { version: "2.1.0" });
			assert.deepEqual(stub.requests[0].body, { name: "My Host", version: "2.1.0" });
			const saved = await savedConfig();
			assert.equal(saved["host.id"], 1234);
			assert.equal(saved["host.name"], "Approved");
			assert.equal(saved["host.controller_token"], "host-token");
		});

		it("does nothing when the controller accepts the saved token", async function() {
			config.set("host.controller_token", "valid-token");
			stub.handler = ({ headers }) => (headers.authorization === "Bearer valid-token"
				? [200, { valid: true }]
				: [401, undefined]
			);
			await ensurePaired(config, { version: "2.1.0" });
			assert.deepEqual(stub.requests.map(r => r.url), ["/api/host-pairing/check"]);
			assert.equal(config.get("host.controller_token"), "valid-token");
		});

		it("asks to join again with the user token when the saved token is not accepted", async function() {
			config.set("host.controller_token", "revoked-token");
			stub.handler = ({ url, headers }) => {
				if (url === "/api/host-pairing/check") {
					return [401, undefined];
				}
				return headers.authorization === "Bearer user-token"
					? [200, { hostId: 5, token: "new-token", name: "My Host" }]
					: [401, { error: "Invalid user token" }];
			};
			await ensurePaired(config, { version: "2.1.0", userToken: "user-token" });
			const saved = await savedConfig();
			assert.equal(saved["host.id"], 5);
			assert.equal(saved["host.controller_token"], "new-token");
			assert(!JSON.stringify(saved).includes("user-token"), "user token must not be saved");
		});

		it("keeps the saved token when it can't be checked", async function() {
			config.set("host.controller_token", "some-token");
			stub.handler = () => [404, undefined];
			await ensurePaired(config, { version: "2.1.0" });
			assert.equal(config.get("host.controller_token"), "some-token");
			assert.equal(stub.requests.length, 1);
		});
	});
});
