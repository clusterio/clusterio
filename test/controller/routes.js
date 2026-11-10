import assert from "node:assert/strict";
import events from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import express from "express";

import * as lib from "@clusterio/lib";
import { HostPairingManager, HostRecord } from "@clusterio/controller";

import * as routes from "@clusterio/controller/dist/node/src/routes.js";
import * as mock from "../mock.js";
import { createZipBuffer } from "../common.js";

import "../setup_logging.js";

describe("controller/src/routes", function() {
	let controller;
	let server;
	let port;
	beforeEach(async function() {
		controller = new mock.MockController();
		routes.addRouteHandlers(controller.app);
		server = http.createServer(routes.httpServerOptions, controller.app);
		server.listen(0, "localhost");
		await events.once(server, "listening");
		port = server.address().port;
	});
	afterEach(function() {
		server.close();
	});

	const largeSize = 64 * 1024 * 1024;
	/**
	 * Send a large body at about 6 MiB/s whether or not the server reads it,
	 * the way a proxy in front of the controller passes on an upload, until
	 * the connection closes, and count what the server read.
	 * @param {string} url - URL to send to.
	 * @param {object} options - Options for the request.
	 * @param {string=} options.method - HTTP method, defaults to PUT.
	 * @param {object=} options.headers - Headers to send.
	 * @param {string=} options.prefix - Content to send before the large body.
	 * @returns {Promise<{ status: number|undefined, body: string, serverBytesRead: number }>} result
	 */
	async function sendLargeBody(url, { method = "PUT", headers = {}, prefix = "" } = {}) {
		const sockets = [];
		const onConnection = socket => sockets.push(socket);
		server.on("connection", onConnection);
		const request = http.request(url, {
			method, headers: { "Content-Length": Buffer.byteLength(prefix) + largeSize, ...headers },
		});
		let status;
		let body = "";
		request.on("response", response => {
			status = response.statusCode;
			response.setEncoding("utf8");
			response.on("data", chunk => { body += chunk; });
			response.on("error", () => {});
		});
		// The server may close the connection while the body is being sent
		request.on("error", () => {});
		const closed = new Promise(resolve => request.on("close", resolve));
		request.write(prefix);
		const chunk = Buffer.alloc(64 * 1024);
		for (let sent = 0; sent < largeSize && !request.closed; sent += chunk.length) {
			request.write(chunk);
			await lib.wait(10);
		}
		if (!request.closed) {
			request.end();
		}
		await closed;
		server.off("connection", onConnection);
		await Promise.all(sockets.map(
			socket => socket.destroyed || new Promise(resolve => socket.on("close", resolve))
		));
		return { status, body, serverBytesRead: sockets.reduce((total, socket) => total + socket.bytesRead, 0) };
	}
	function assertNotRead(result) {
		assert(
			result.serverBytesRead < largeSize / 4,
			`server read ${result.serverBytesRead} of ${largeSize} bytes`
		);
	}
	function multipartPrefix(boundary, fields, filename, mime = "application/zip") {
		let prefix = "";
		for (const [name, value] of Object.entries(fields)) {
			prefix += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
		}
		return `${prefix}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
			`Content-Type: ${mime}\r\n\r\n`;
	}
	describe("/api/stream/:id", function() {
		let endpoint;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/stream`;
		});
		it("should respond with 404 if stream doesn't exist", async function() {
			let response;
			response = await fetch(`${endpoint}/01020304`);
			assert.equal(response.status, 404);
			response = await fetch(`${endpoint}/01020304`, {
				method: "PUT", body: "test stream",
			});
			assert.equal(response.status, 404);
		});
		it("should respond with 500 if stream times out", async function() {
			let stream = await routes.createProxyStream(controller.app);
			let response = await fetch(`${endpoint}/${stream.id}`);
			assert.equal(response.status, 500);
		});
		it("should not read the body of a PUT to a stream that doesn't exist", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(`${endpoint}/01020304`);
			assert.equal(result.status, 404);
			assertNotRead(result);
		});
		it("should not read the body of a PUT to a stream that times out", async function() {
			this.timeout(30000);
			const stream = await routes.createProxyStream(controller.app);
			const result = await sendLargeBody(`${endpoint}/${stream.id}`);
			assert.equal(result.status, 500);
			assertNotRead(result);
		});
		it("should respond with 500 and stop reading when the receiver disconnects", async function() {
			this.timeout(30000);
			const stream = await routes.createProxyStream(controller.app);
			const upload = sendLargeBody(`${endpoint}/${stream.id}`);
			const abort = new AbortController();
			const response = await fetch(`${endpoint}/${stream.id}`, { signal: abort.signal });
			assert.equal(response.status, 200);
			await response.body.getReader().read();
			abort.abort();
			const result = await upload;
			assert.equal(result.status, 500);
			assertNotRead(result);
		});
		it("should close the receiver when the upload is cut short", async function() {
			const stream = await routes.createProxyStream(controller.app);
			const request = http.request(
				`${endpoint}/${stream.id}`, { method: "PUT", headers: { "Content-Length": 1024 * 1024 } }
			);
			request.on("error", () => {});
			request.write(Buffer.alloc(1024));
			const response = await fetch(`${endpoint}/${stream.id}`);
			assert.equal(response.status, 200);
			request.destroy();
			await assert.rejects(response.arrayBuffer());
		});
		it("should close a transfer that stops making progress", async function() {
			controller.mockConfigEntries.set("controller.transfer_idle_timeout", 0.5);
			const stream = await routes.createProxyStream(controller.app);
			const request = http.request(
				`${endpoint}/${stream.id}`, { method: "PUT", headers: { "Content-Length": 1024 * 1024 } }
			);
			request.on("error", () => {});
			const closed = new Promise(resolve => request.on("close", resolve));
			request.write(Buffer.alloc(1024));
			const response = await fetch(`${endpoint}/${stream.id}`);
			assert.equal(response.status, 200);
			const start = Date.now();
			await assert.rejects(response.arrayBuffer());
			await closed;
			assert(Date.now() - start < 1500, `closed after ${Date.now() - start} ms`);
		});
		it("should not close a slow transfer that makes progress", async function() {
			this.timeout(10000);
			controller.mockConfigEntries.set("controller.transfer_idle_timeout", 0.5);
			const stream = await routes.createProxyStream(controller.app);
			const request = http.request(
				`${endpoint}/${stream.id}`, { method: "PUT", headers: { "Content-Length": 10 * 1024 } }
			);
			const uploaded = events.once(request, "response");
			const download = fetch(`${endpoint}/${stream.id}`).then(response => response.arrayBuffer());
			for (let i = 0; i < 10; i++) {
				request.write(Buffer.alloc(1024));
				await lib.wait(200);
			}
			request.end();
			const [response] = await uploaded;
			response.resume();
			assert.equal(response.statusCode, 200);
			assert.equal((await download).byteLength, 10 * 1024);
		});
		it("should passthrough a stream", async function() {
			let stream;
			let responses;
			stream = await routes.createProxyStream(controller.app);
			responses = await Promise.all([
				(async function() {
					await lib.wait(100);
					return await fetch(`${endpoint}/${stream.id}`, {
						method: "PUT", body: "test content",
					});
				}()),
				fetch(`${endpoint}/${stream.id}`),
			]);
			assert.equal(responses[0].status, 200);
			assert.equal(responses[1].status, 200);
			assert.equal(await responses[1].text(), "test content");
			stream = await routes.createProxyStream(controller.app);
			responses = await Promise.all([
				fetch(`${endpoint}/${stream.id}`, {
					method: "PUT", body: "test content",
				}),
				(async function() {
					await lib.wait(100);
					return await fetch(`${endpoint}/${stream.id}`);
				}()),
			]);
			assert.equal(responses[0].status, 200);
			assert.equal(responses[1].status, 200);
			assert.equal(await responses[1].text(), "test content");
		});
	});
	describe("/metrics", function() {
		let endpoint, testToken;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/metrics`;
			testToken = controller.users.signUserToken({ id: "test" });
		});
		it("should respond with 401 without a valid token", async function() {
			let response;
			response = await fetch(endpoint);
			assert.equal(response.status, 401);
			response = await fetch(endpoint, { headers: { "X-Access-Token": "invalid" } });
			assert.equal(response.status, 401);
			response = await fetch(endpoint, { headers: { "Authorization": "Bearer invalid" } });
			assert.equal(response.status, 401);
			response = await fetch(endpoint, { headers: { "Authorization": `Basic ${testToken}` } });
			assert.equal(response.status, 401);
			const user = controller.users.getOrCreateUser("test");
			user.tokenValidAfter = Math.floor((Date.now() + 60e3) / 1000);
			user.saveRecord();
			response = await fetch(endpoint, { headers: { "Authorization": `Bearer ${testToken}` } });
			assert.equal(response.status, 401);
		});
		it("should respond with 403 when user has insufficient permission", async function() {
			const user = controller.users.getOrCreateUser("player");
			let response = await fetch(endpoint, {
				headers: { "Authorization": `Bearer ${controller.users.signUserToken(user)}` },
			});
			assert.equal(response.status, 403);
		});
		it("should respond with metrics to an authorized user", async function() {
			for (const headers of [
				{ "X-Access-Token": testToken },
				{ "Authorization": `Bearer ${testToken}` },
				{ "Authorization": `bearer ${testToken}` },
			]) {
				let response = await fetch(endpoint, { headers });
				assert.equal(response.status, 200);
				const contentType = response.headers.get("content-type");
				for (const part of lib.expositionContentType.split("; ")) {
					assert(contentType.includes(part), `expected ${part} in content type ${contentType}`);
				}
				assert(/^# HELP /m.test(await response.text()), "expected exposition text");
			}
		});
		it("should share one gather between concurrent requests", async function() {
			let calls = 0;
			controller.hooks.metrics.attach("test", async () => {
				calls += 1;
				await lib.wait(100);
			});
			const headers = { "X-Access-Token": testToken };
			let responses = await Promise.all([
				fetch(endpoint, { headers }),
				fetch(endpoint, { headers }),
				fetch(endpoint, { headers }),
			]);
			for (const response of responses) {
				assert.equal(response.status, 200);
			}
			assert.equal(calls, 1);
			let response = await fetch(endpoint, { headers });
			assert.equal(response.status, 200);
			assert.equal(calls, 2);
		});
	});
	describe("missingExportAsset()", function() {
		let dir;
		beforeEach(async function() {
			dir = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-static-"));
			await fs.writeFile(path.join(dir, "locale.abc.json"), "[]");
			const provider = new lib.MemoryDatastoreProvider();
			controller.modPacks = new lib.SubscribableDatastore(provider, new Map());
			const modPack = lib.ModPack.fromJSON({ id: 1, name: "test" });
			modPack.exportManifest = new lib.ExportManifest({
				locale: "locale.abc.json", metadata: "metadata.abc.json",
			});
			controller.modPacks.set(modPack);
			controller.app.use("/static", express.static(dir));
			controller.app.use("/static", routes.missingExportAsset);
		});
		afterEach(async function() {
			await fs.rm(dir, { recursive: true, force: true });
		});
		it("should serve export files that exist", async function() {
			const response = await fetch(`http://localhost:${port}/static/locale.abc.json`);
			assert.equal(response.status, 200);
			assert(controller.modPacks.get(1).exportManifest);
		});
		it("should drop the export and explain when a file is missing", async function() {
			const response = await fetch(`http://localhost:${port}/static/metadata.abc.json`);
			assert.equal(response.status, 404);
			assert.match(await response.text(), /metadata\.abc\.json is missing/);
			assert.equal(controller.modPacks.get(1).exportManifest, undefined);
		});
		it("should pass through files not in an export", async function() {
			const response = await fetch(`http://localhost:${port}/static/other.js`);
			assert.equal(response.status, 404);
			assert.doesNotMatch(await response.text(), /export-data/);
			assert(controller.modPacks.get(1).exportManifest);
		});
	});
	describe("stripStaticPrefix()", function() {
		it("should remove a leading static/", function() {
			assert.equal(routes.stripStaticPrefix("static/main.abc.js"), "main.abc.js");
		});
		it("should leave other paths alone", function() {
			assert.equal(routes.stripStaticPrefix("main.abc.js"), "main.abc.js");
			assert.equal(routes.stripStaticPrefix("other/static/main.js"), "other/static/main.js");
		});
	});
	describe("/api/plugins", function() {
		let endpoint;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/plugins`;
			controller.mockConfigEntries.set("foo.load_plugin", true);
		});
		it("should strip static/ from the plugin bundle path", async function() {
			controller.pluginInfos = [{
				name: "foo", version: "1.0.0", npmPackage: "foo",
				manifest: { main: "static/foo.abc.js" },
			}];
			controller.loadedPlugins = new Set(controller.pluginInfos);
			let response = await fetch(endpoint);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), [{
				name: "foo", version: "1.0.0", enabled: true, loaded: true, npmPackage: "foo",
				web: { main: "foo.abc.js" },
			}]);
		});
		it("should report missing manifest and entrypoint", async function() {
			controller.pluginInfos = [
				{ name: "foo", version: "1.0.0", npmPackage: "foo", webEntrypoint: "dist/web/index.js" },
				{ name: "bar", version: "1.0.0", npmPackage: "bar", manifest: {} },
				{ name: "baz", version: "1.0.0", npmPackage: "baz", manifest: { "baz.js": "static/baz.abc.js" } },
			];
			controller.loadedPlugins = new Set([controller.pluginInfos[0]]);
			let response = await fetch(endpoint);
			assert.equal(response.status, 200);
			let data = await response.json();
			assert.equal(data[0].web.error, "Missing dist/web/manifest.json");
			const incompatible = "Incompatible dist/web/manifest.json, the plugin must be rebuilt with Vite";
			assert.equal(data[1].web.error, incompatible);
			assert.equal(data[2].web.error, incompatible);
			assert.equal(data[1].loaded, false);
			assert.equal(data[1].enabled, false);
		});
		it("should not report a missing manifest for plugins without a web build", async function() {
			controller.pluginInfos = [
				{ name: "foo", version: "1.0.0", npmPackage: "foo", hostEntrypoint: "dist/node/host.js" },
				{ name: "bar", version: "1.0.0", npmPackage: "bar", controllerEntrypoint: "dist/node/controller.js" },
				{ name: "baz", version: "1.0.0", npmPackage: "baz", instanceConfigFields: {} },
			];
			let response = await fetch(endpoint);
			assert.equal(response.status, 200);
			let data = await response.json();
			assert.deepEqual(data[0].web, {});
			assert.equal(data[1].web.error, "Missing dist/web/manifest.json");
			assert.equal(data[2].web.error, "Missing dist/web/manifest.json");
		});
	});
	describe("/api/cluster-name", function() {
		let endpoint;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/cluster-name`;
		});
		it("should return the cluster name from config", async function() {
			controller.mockConfigEntries.set("controller.name", "Test Cluster");
			let response = await fetch(endpoint);
			assert.equal(response.status, 200);
			let data = await response.json();
			assert.deepEqual(data, { name: "Test Cluster" });
		});
	});
	describe("/api/host-pairing", function() {
		let endpoint, adminToken, playerToken;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/host-pairing`;
			// The mock controller lacks what pairing needs, use the real implementations.
			controller.hostPairing = new HostPairingManager(controller);
			controller.wsServer.remoteAddr = req => req.socket.remoteAddress;
			adminToken = controller.users.signUserToken(controller.users.getByName("test"));
			playerToken = controller.users.signUserToken(controller.users.getByName("player"));
		});

		function createHost(name) {
			const host = controller.hosts.createHost(name);
			return { hostId: host.id, token: controller.hosts.signHostToken(host.id) };
		}

		function post(urlPath, body, headers = {}) {
			return fetch(`${endpoint}${urlPath}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: typeof body === "string" || body === undefined ? body : JSON.stringify(body),
			});
		}

		async function assertResponse(response, status, body) {
			assert.equal(response.status, status);
			assert.equal(response.headers.get("cache-control"), "no-store");
			if (body !== undefined) {
				assert.deepEqual(await response.json(), body);
			}
		}

		async function createRequest(name = "Host A") {
			const response = await post("", { name });
			assert.equal(response.status, 202);
			return await response.json();
		}

		function check(headers) {
			return fetch(`${endpoint}/check`, { headers });
		}

		function assertNothingCreated() {
			assert.equal(controller.hostPairing.records.size, 0, "a pending request was created");
			assert.equal(controller.hosts.records.size, 0, "a host was created");
		}

		describe("POST /api/host-pairing", function() {
			it("should create a pending request", async function() {
				const response = await post("", { name: "Host A", version: "2.0.0" });
				assert.equal(response.status, 202);
				assert.equal(response.headers.get("cache-control"), "no-store");
				const body = await response.json();
				assert.deepEqual(Object.keys(body).sort(), ["code", "requestId"]);
				assert.match(body.code, /^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);

				const details = controller.hostPairing.records.get(body.code);
				assert.equal(details.name, "Host A");
				assert.equal(details.version, "2.0.0");
				assert.match(details.remoteAddress, /127\.0\.0\.1|::1/);
				assert.equal(controller.hosts.records.size, 0);
			});
			it("should trim the name and limit the version", async function() {
				let { code } = await (await post("", { name: "  Host A ", version: "x".repeat(100) })).json();
				let details = controller.hostPairing.records.get(code);
				assert.equal(details.name, "Host A");
				assert.equal(details.version, "x".repeat(64));

				({ code } = await (await post("", { name: "Host B", version: 5 })).json());
				details = controller.hostPairing.records.get(code);
				assert.equal(details.version, "");
			});
			it("should respond with 400 for a missing or invalid name", async function() {
				const required = { error: "Host name is required" };
				await assertResponse(await post("", {}), 400, required);
				await assertResponse(await post("", { name: "" }), 400, required);
				await assertResponse(await post("", { name: "  " }), 400, required);
				await assertResponse(await post("", { name: 5 }), 400, required);
				await assertResponse(await post("", undefined), 400, required);
				await assertResponse(await post("", "name=Host", { "Content-Type": "text/plain" }), 400, required);
				await assertResponse(
					await post("", { name: "x".repeat(101) }),
					400, { error: "Host name must be at most 100 characters" },
				);
				assertNothingCreated();
			});
			it("should respond with 400 for malformed JSON", async function() {
				controller.app.set("env", "test"); // Silence the default error handler
				const response = await post("", "{\"name\":");
				assert.equal(response.status, 400);
				assertNothingCreated();
			});
			it("should respond with 413 for a body over 4kb", async function() {
				controller.app.set("env", "test"); // Silence the default error handler
				const response = await post("", { name: "x".repeat(5000) });
				assert.equal(response.status, 413);
				assertNothingCreated();
			});
			it("should respond with 429 and Retry-After when limited", async function() {
				for (let i = 0; i < 3; i++) {
					await createRequest();
				}
				const response = await post("", { name: "Host A" });
				assert.equal(response.headers.get("retry-after"), "30");
				await assertResponse(response, 429, { error: "Too many pending requests from this address" });
				assert.equal(controller.hostPairing.records.size, 3);
			});
			it("should respond with 503 in recovery mode", async function() {
				controller.recoveryMode = true;
				const recovery = { error: "Controller is in recovery mode" };
				await assertResponse(await post("", { name: "Host A" }), 503, recovery);
				await assertResponse(
					await post("", { name: "Host A" }, { "Authorization": `Bearer ${adminToken}` }), 503, recovery
				);
				assertNothingCreated();
			});
			it("should approve directly with the token of a user allowed to approve hosts", async function() {
				for (const headers of [
					{ "Authorization": `Bearer ${adminToken}` },
					{ "Authorization": `bearer ${adminToken}` },
					{ "X-Access-Token": adminToken },
				]) {
					const response = await post("", { name: "Host A" }, headers);
					assert.equal(response.status, 200);
					assert.equal(response.headers.get("cache-control"), "no-store");
					const body = await response.json();
					assert.deepEqual(Object.keys(body).sort(), ["hostId", "name", "token"]);
					assert.equal(body.name, "Host A");
					assert.equal(controller.hosts.get(body.hostId).name, "Host A");
					const payload = jwt.verify(body.token, controller.authSecret, { audience: "host" });
					assert.equal(payload.host, body.hostId);
				}
				assert.equal(controller.hosts.records.size, 3);
				assert.equal(controller.hostPairing.records.size, 0, "a pending request was created");
			});
			it("should validate the name before approving directly", async function() {
				await assertResponse(
					await post("", {}, { "Authorization": `Bearer ${adminToken}` }),
					400, { error: "Host name is required" },
				);
				assertNothingCreated();
			});
			it("should respond with 403 for a user not allowed to approve hosts", async function() {
				await assertResponse(
					await post("", { name: "Host A" }, { "Authorization": `Bearer ${playerToken}` }),
					403, { error: "User player is not allowed to approve hosts" },
				);
				assertNothingCreated();
			});
			it("should respond with 401 for an invalid token without creating a request", async function() {
				// The admin user's tokens are revoked after signing this one
				const revokedToken = adminToken;
				const user = controller.users.getOrCreateUser("test");
				user.tokenValidAfter = Math.floor((Date.now() + 60e3) / 1000);
				user.saveRecord();
				controller.hosts.records.set(new HostRecord(5, "five", "", new Map()));
				const hostToken = controller.hosts.signHostToken(5);
				controller.hosts.records.delete(controller.hosts.get(5));

				for (const headers of [
					{ "Authorization": "Bearer invalid" },
					{ "X-Access-Token": "invalid" },
					{ "Authorization": `Bearer ${controller.users.signUserToken({ id: "nobody" })}` },
					{ "Authorization": `Bearer ${revokedToken}` },
					{ "Authorization": `Bearer ${hostToken}` },
				]) {
					await assertResponse(
						await post("", { name: "Host A" }, headers), 401, { error: "Invalid user token" }
					);
				}
				assertNothingCreated();
			});
		});

		describe("POST /api/host-pairing/poll", function() {
			it("should respond with 202 while pending", async function() {
				const { requestId } = await createRequest();
				await assertResponse(await post("/poll", { requestId }), 202, { status: "pending" });
				await assertResponse(await post("/poll", { requestId }), 202, { status: "pending" });
			});
			it("should hand over the result of an approved request once", async function() {
				const { requestId, code } = await createRequest();
				const hostId = controller.hostPairing.approve(code, "Renamed", "test");

				const response = await post("/poll", { requestId });
				assert.equal(response.status, 200);
				assert.equal(response.headers.get("cache-control"), "no-store");
				const body = await response.json();
				assert.deepEqual(Object.keys(body).sort(), ["hostId", "name", "token"]);
				assert.equal(body.hostId, hostId);
				assert.equal(body.name, "Renamed");
				assert.equal(jwt.verify(body.token, controller.authSecret, { audience: "host" }).host, hostId);

				await assertResponse(await post("/poll", { requestId }), 404, { error: "Request not found" });
			});
			it("should respond with 403 once for a rejected request", async function() {
				const { requestId, code } = await createRequest();
				controller.hostPairing.reject(code, "test");
				await assertResponse(await post("/poll", { requestId }), 403, { error: "Request was rejected" });
				await assertResponse(await post("/poll", { requestId }), 404, { error: "Request not found" });
			});
			it("should respond with 404 for an unknown request", async function() {
				const { code } = await createRequest();
				const notFound = { error: "Request not found" };
				await assertResponse(await post("/poll", { requestId: "invalid" }), 404, notFound);
				await assertResponse(await post("/poll", { requestId: code }), 404, notFound);
			});
			it("should respond with 400 without a requestId in the body", async function() {
				const { requestId } = await createRequest();
				const required = { error: "requestId is required" };
				await assertResponse(await post("/poll", {}), 400, required);
				await assertResponse(await post("/poll", { requestId: 5 }), 400, required);
				await assertResponse(await post(`/poll?requestId=${encodeURIComponent(requestId)}`, {}), 400, required);
			});
			it("should respond with 503 in recovery mode", async function() {
				const { requestId } = await createRequest();
				controller.recoveryMode = true;
				await assertResponse(
					await post("/poll", { requestId }), 503, { error: "Controller is in recovery mode" }
				);
			});
		});

		describe("POST /api/host-pairing/cancel", function() {
			it("should cancel a pending request", async function() {
				const { requestId, code } = await createRequest();
				await assertResponse(await post("/cancel", { requestId }), 204);
				assert.equal(controller.hostPairing.records.has(code), false);
				await assertResponse(await post("/poll", { requestId }), 404, { error: "Request not found" });
			});
			it("should respond with 204 for an unknown request", async function() {
				const { code } = await createRequest();
				await assertResponse(await post("/cancel", { requestId: "invalid" }), 204);
				await assertResponse(await post("/cancel", { requestId: code }), 204);
				assert(controller.hostPairing.records.has(code), "cancelled by the code");
			});
		});

		describe("request ids", function() {
			it("should not be accepted in the URL", async function() {
				const { requestId } = await createRequest();
				const id = encodeURIComponent(requestId);
				for (const [method, urlPath] of [
					["GET", `/poll?requestId=${id}`],
					["GET", `/poll/${id}`],
					["POST", `/poll/${id}`],
					["POST", `/${id}`],
					["GET", `/${id}`],
					["POST", `/cancel/${id}`],
				]) {
					const response = await fetch(`${endpoint}${urlPath}`, { method });
					assert.equal(response.status, 404, `${method} ${urlPath}`);
				}
				await assertResponse(await post("/poll", { requestId }), 202, { status: "pending" });
			});
		});

		describe("GET /api/host-pairing/check", function() {
			it("should respond with 200 for a valid host token", async function() {
				const { hostId, token } = createHost("Host A");
				for (const headers of [
					{ "Authorization": `Bearer ${token}` },
					{ "X-Access-Token": token },
				]) {
					await assertResponse(await check(headers), 200, { valid: true });
				}
				assert(controller.hosts.has(hostId));
			});
			it("should respond with 200 for a host token from before the slave rename", async function() {
				const { hostId } = createHost("Host A");
				const token = jwt.sign({ aud: "slave", slave: hostId }, controller.authSecret);
				await assertResponse(await check({ "Authorization": `Bearer ${token}` }), 200, { valid: true });
			});
			it("should respond with 401 without a valid host token", async function() {
				createHost("Host A");
				assert.equal((await check({})).status, 401);
				assert.equal((await check({ "Authorization": "Bearer invalid" })).status, 401);
				assert.equal((await check({ "Authorization": `Bearer ${adminToken}` })).status, 401);
			});
			it("should respond with 401 once the host is revoked", async function() {
				const { hostId, token } = createHost("Host A");
				await assertResponse(await check({ "Authorization": `Bearer ${token}` }), 200, { valid: true });
				controller.hosts.records.delete(controller.hosts.get(hostId));
				assert.equal((await check({ "Authorization": `Bearer ${token}` })).status, 401);
			});
		});
	});
	describe("/api/upload-save", function() {
		let endpoint, testToken;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/upload-save`;
			testToken = controller.users.signUserToken({ id: "test" });
		});
		it("should respond with 401 with invalid token", async function() {
			let response;
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: { "Content-Type": "application/zip" },
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": "invalid",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": controller.users.signUserToken({ id: "invalid" }),
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
			const user = controller.users.getOrCreateUser("test");
			user.tokenValidAfter = Math.floor((Date.now() + 60e3) / 1000);
			user.saveRecord();
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": testToken,
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
		});

		it("should respond with 403 when user has insufficient permission", async function() {
			const user = controller.users.getOrCreateUser("player");
			let response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": controller.users.signUserToken(user),
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 403);
		});

		it("should respond with 415 if content type is missing or invalid", async function() {
			let response;
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { request_errors: ["invalid Content-Type"] });
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "invalid",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { request_errors: ["invalid Content-Type"] });
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "text/plain",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { request_errors: ["invalid Content-Type"] });
		});

		it("should respond with 400 if invalid multipart request", async function() {
			let response;
			let form;
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", new Blob(["totally a zip file"], { type: "text/plain" }), "test.zip");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: form,
			});
			assert.equal(response.status, 400);
			assert.deepEqual(await response.json(), { request_errors: ["invalid file Content-Type"] });
			form = new FormData();
			form.append("file", new Blob(["totally a zip file"], { type: "application/zip" }), "test.zip");
			form.append("instance_id", "123");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: form,
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["instance_id must come before files uploaded"] }
			);
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", new Blob(["totally a zip file"], { type: "application/zip" }), "test.txt");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: form,
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["filename must end with .zip"] }
			);
			form = new FormData();
			form.append("instance_id", "invalid");
			form.append("file", new Blob(["totally a zip file"], { type: "application/zip" }), "test.zip");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: form,
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["invalid instance_id"] }
			);
		});

		it("should respond with 400 if invalid file request", async function() {
			let response;
			response = await fetch(`${endpoint}?instance_id=123`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 400);
			assert.deepEqual(await response.json(), { request_errors: ["Missing or invalid filename parameter"] });
			response = await fetch(`${endpoint}?instance_id=123&filename=test.txt`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 400);
			assert.deepEqual(await response.json(), { request_errors: ["filename must end with .zip"] });
			response = await fetch(`${endpoint}?filename=test.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["Missing or invalid instance_id parameter"] }
			);
		});

		it("should respond with 500 if the transfer failed", async function() {
			controller.sendToHostByInstanceId = async (request) => {
				throw new Error("Something went wrong");
			};
			let response;
			let form;
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", new Blob(["totally a zip file"], { type: "application/zip" }), "test.zip");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				body: form,
			});
			assert.equal(response.status, 500);
			assert.deepEqual(await response.json(), { errors: ["Something went wrong"], request_errors: [] });
			response = await fetch(`${endpoint}?instance_id=123&filename=test.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 500);
			assert.deepEqual(await response.json(), { errors: ["Something went wrong"], request_errors: [] });
			controller.sendToHostByInstanceId = async (request) => {
				await new Promise(() => {});
			};
			response = await fetch(`${endpoint}?instance_id=123&filename=test.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 500);
			assert.deepEqual(
				await response.json(), { errors: ["Timed out establishing stream to host"], request_errors: [] }
			);
		});

		it("should complete a valid transfer", async function() {
			controller.sendToHostByInstanceId = async (request) => {
				const stream = await fetch(`http://localhost:${port}/api/stream/${request.streamId}`);
				assert.equal(await stream.text(), "totally a zip file");
				return request.name;
			};
			let response;
			response = await fetch(`${endpoint}?instance_id=123&filename=test.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				body: "totally a zip file",
			});
			assert.deepEqual(await response.json(), { saves: ["test.zip"] });
			assert.equal(response.status, 200);
		});
		it("should complete a valid transfer with non-standerd mime type", async function() {
			controller.sendToHostByInstanceId = async (request) => {
				const stream = await fetch(`http://localhost:${port}/api/stream/${request.streamId}`);
				assert.equal(await stream.text(), "totally a zip file");
				return request.name;
			};
			let response;
			response = await fetch(`${endpoint}?instance_id=123&filename=test.zip`, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/x-zip-compressed",
				},
				body: "totally a zip file",
			});
			assert.deepEqual(await response.json(), { saves: ["test.zip"] });
			assert.equal(response.status, 200);
		});

		function uploadVariants() {
			return [
				{
					url: `${endpoint}?instance_id=123&filename=test.zip`,
					headers: { "Content-Type": "application/zip" },
				},
				{
					url: endpoint,
					headers: { "Content-Type": "multipart/form-data; boundary=test" },
					prefix: multipartPrefix("test", { instance_id: "123" }, "test.zip"),
				},
			];
		}
		it("should not read the body of an upload without a valid token", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST", headers: { "Content-Type": "application/zip" },
			});
			assert.equal(result.status, 401);
			assertNotRead(result);
		});
		it("should not read the body of an invalid file request", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(`${endpoint}?instance_id=123&filename=test.txt`, {
				method: "POST", headers: { "Content-Type": "application/zip", "X-Access-Token": testToken },
			});
			assert.equal(result.status, 400);
			assert.deepEqual(JSON.parse(result.body), { request_errors: ["filename must end with .zip"] });
			assertNotRead(result);
		});
		it("should not read the body of an invalid multipart request", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(endpoint, {
				method: "POST",
				headers: { "Content-Type": "multipart/form-data; boundary=test", "X-Access-Token": testToken },
				prefix: multipartPrefix("test", { instance_id: "invalid" }, "test.zip"),
			});
			assert.equal(result.status, 400);
			assert.deepEqual(JSON.parse(result.body), { request_errors: ["invalid instance_id"] });
			assertNotRead(result);
		});
		it("should not read the body of an upload the host fails to receive", async function() {
			this.timeout(30000);
			controller.sendToHostByInstanceId = async (request) => {
				throw new Error("Something went wrong");
			};
			for (const options of uploadVariants()) {
				const result = await sendLargeBody(options.url, {
					method: "POST",
					headers: { ...options.headers, "X-Access-Token": testToken },
					prefix: options.prefix,
				});
				assert.equal(result.status, 500);
				assert.deepEqual(JSON.parse(result.body), { errors: ["Something went wrong"], request_errors: [] });
				assertNotRead(result);
			}
		});
		it("should not read the body of an upload the host never fetches", async function() {
			this.timeout(30000);
			controller.sendToHostByInstanceId = async (request) => {
				await new Promise(() => {});
			};
			const result = await sendLargeBody(`${endpoint}?instance_id=123&filename=test.zip`, {
				method: "POST", headers: { "Content-Type": "application/zip", "X-Access-Token": testToken },
			});
			assert.equal(result.status, 500);
			assert.deepEqual(
				JSON.parse(result.body), { errors: ["Timed out establishing stream to host"], request_errors: [] }
			);
			assertNotRead(result);
		});
		async function cutUploadShort(options) {
			const request = http.request(options.url, {
				method: "POST",
				headers: { ...options.headers, "X-Access-Token": testToken, "Content-Length": 1024 * 1024 },
			});
			request.on("error", () => {});
			const transfer = new Promise(resolve => {
				controller.sendToHostByInstanceId = async (pullRequest) => {
					const stream = await fetch(`http://localhost:${port}/api/stream/${pullRequest.streamId}`);
					request.destroy();
					try {
						await stream.arrayBuffer();
						resolve("completed");
					} catch (err) {
						resolve("failed");
						throw err;
					}
					return pullRequest.name;
				};
			});
			request.write(options.prefix ?? "");
			request.write(Buffer.alloc(1024));
			return await transfer;
		}
		it("should fail the transfer to the host when the upload is cut short", async function() {
			for (const options of uploadVariants()) {
				assert.equal(await cutUploadShort(options), "failed");
			}
		});
	});
	describe("/api/upload-mod", function() {
		let endpoint, testToken, modsDirectory;
		beforeEach(async function() {
			endpoint = `http://localhost:${port}/api/upload-mod`;
			testToken = controller.users.signUserToken({ id: "test" });
			modsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "clusterio-mods-"));
			controller.mockConfigEntries.set("controller.mods_directory", modsDirectory);
			controller.modStore = { addMod() {} };
		});
		afterEach(async function() {
			await fs.rm(modsDirectory, { recursive: true, force: true });
		});
		async function waitForEmptyModsDirectory() {
			for (let i = 0; i < 50 && (await fs.readdir(modsDirectory)).length; i++) {
				await lib.wait(20);
			}
			assert.deepEqual(await fs.readdir(modsDirectory), []);
		}

		it("should respond with 403 when user has insufficient permission", async function() {
			const user = controller.users.getOrCreateUser("player");
			const response = await fetch(`${endpoint}?filename=mod_1.0.0.zip`, {
				method: "POST",
				headers: { "Content-Type": "application/zip", "X-Access-Token": controller.users.signUserToken(user) },
				body: "totally a zip file",
			});
			assert.equal(response.status, 403);
		});
		it("should respond with 415 if content type is invalid", async function() {
			const response = await fetch(`${endpoint}?filename=mod_1.0.0.zip`, {
				method: "POST",
				headers: { "Content-Type": "text/plain", "X-Access-Token": testToken },
				body: "totally a zip file",
			});
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { request_errors: ["invalid Content-Type"] });
		});
		it("should store an uploaded mod", async function() {
			const info = await fs.readFile(path.join("test", "file", "empty_mod", "info.json"));
			const zip = await createZipBuffer([["empty_mod_1.0.0/info.json", info]]);
			const form = new FormData();
			form.append("file", new Blob([zip], { type: "application/zip" }), "upload.zip");
			for (const options of [
				{ url: `${endpoint}?filename=upload.zip`, headers: { "Content-Type": "application/zip" }, body: zip },
				{ url: endpoint, body: form },
			]) {
				const added = [];
				controller.modStore = { addMod: mod => added.push(mod.filename) };
				const response = await fetch(options.url, {
					method: "POST", headers: { ...options.headers, "X-Access-Token": testToken }, body: options.body,
				});
				assert.equal(response.status, 200);
				assert.equal((await response.json()).mods[0].name, "empty_mod");
				assert.deepEqual(added, ["empty_mod_1.0.0.zip"]);
				assert.deepEqual(await fs.readdir(modsDirectory), ["empty_mod_1.0.0.zip"]);
			}
		});
		it("should respond with 500 and remove the file if it's not a mod", async function() {
			for (const options of [
				{ url: `${endpoint}?filename=mod_1.0.0.zip`, type: "application/zip", body: "totally a zip file" },
				{ url: endpoint, body: new FormData() },
			]) {
				if (options.body instanceof FormData) {
					options.body.append(
						"file", new Blob(["totally a zip file"], { type: "application/zip" }), "mod_1.0.0.zip"
					);
				}
				const response = await fetch(options.url, {
					method: "POST",
					headers: { ...options.type && { "Content-Type": options.type }, "X-Access-Token": testToken },
					body: options.body,
				});
				assert.equal(response.status, 500);
				const result = await response.json();
				assert.equal(result.errors.length, 1);
				assert.deepEqual(result.request_errors, []);
				assert.deepEqual(await fs.readdir(modsDirectory), []);
			}
		});
		it("should not read the body of an invalid file request", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(`${endpoint}?filename=mod_1.0.0.txt`, {
				method: "POST", headers: { "Content-Type": "application/zip", "X-Access-Token": testToken },
			});
			assert.equal(result.status, 400);
			assert.deepEqual(JSON.parse(result.body), { request_errors: ["filename must end with .zip"] });
			assertNotRead(result);
		});
		it("should not read the body of an invalid multipart request", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(endpoint, {
				method: "POST",
				headers: { "Content-Type": "multipart/form-data; boundary=test", "X-Access-Token": testToken },
				prefix: multipartPrefix("test", {}, "mod_1.0.0.zip", "text/plain"),
			});
			assert.equal(result.status, 400);
			assert.deepEqual(JSON.parse(result.body), { request_errors: ["invalid file Content-Type"] });
			assertNotRead(result);
		});
		it("should remove the file when the upload is cut short", async function() {
			for (const options of [
				{ url: `${endpoint}?filename=mod_1.0.0.zip`, headers: { "Content-Type": "application/zip" } },
				{
					url: endpoint,
					headers: { "Content-Type": "multipart/form-data; boundary=test" },
					prefix: multipartPrefix("test", {}, "mod_1.0.0.zip"),
				},
			]) {
				const request = http.request(options.url, {
					method: "POST",
					headers: { ...options.headers, "X-Access-Token": testToken, "Content-Length": 1024 * 1024 },
				});
				request.on("error", () => {});
				request.write(options.prefix ?? "");
				request.write(Buffer.alloc(1024));
				for (let i = 0; i < 50 && !(await fs.readdir(modsDirectory)).length; i++) {
					await lib.wait(20);
				}
				assert.deepEqual(await fs.readdir(modsDirectory), ["mod_1.0.0.tmp.zip"]);
				request.destroy();
				await waitForEmptyModsDirectory();
			}
		});
	});
	describe("/api/upload-export", function() {
		let endpoint;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/upload-export`;
		});
		it("should not read the body of an upload without a valid token", async function() {
			this.timeout(30000);
			const result = await sendLargeBody(`${endpoint}?mod_pack_id=1`, {
				headers: { "Content-Type": "application/zip" },
			});
			assert.equal(result.status, 401);
			assertNotRead(result);
		});
		it("should not read the body of an invalid upload", async function() {
			this.timeout(30000);
			const hostToken = controller.hosts.signHostToken(controller.hosts.createHost("Host A").id);
			const result = await sendLargeBody(`${endpoint}?mod_pack_id=invalid`, {
				headers: { "Content-Type": "application/zip", "X-Access-Token": hostToken },
			});
			assert.equal(result.status, 400);
			assertNotRead(result);
		});
	});
});
