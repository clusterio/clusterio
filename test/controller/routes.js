import assert from "node:assert/strict";
import events from "node:events";
import http from "node:http";

import jwt from "jsonwebtoken";

import { SubscribableDatastore, wait, expositionContentType } from "@clusterio/lib";
import { Controller, HostPairingManager, HostRecord } from "@clusterio/controller";
import * as routes from "@clusterio/controller/dist/node/src/routes.js";
import * as mock from "../mock.js";

import "../setup_logging.js";

describe("controller/src/routes", function() {
	let controller;
	let server;
	let port;
	beforeEach(async function() {
		controller = new mock.MockController();
		routes.addRouteHandlers(controller.app);
		server = http.createServer(controller.app);
		server.listen(0, "localhost");
		await events.once(server, "listening");
		port = server.address().port;
	});
	afterEach(function() {
		server.close();
	});
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
		it("should passthrough a stream", async function() {
			let stream;
			let responses;
			stream = await routes.createProxyStream(controller.app);
			responses = await Promise.all([
				(async function() {
					await wait(100);
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
					await wait(100);
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
				for (const part of expositionContentType.split("; ")) {
					assert(contentType.includes(part), `expected ${part} in content type ${contentType}`);
				}
				assert(/^# HELP /m.test(await response.text()), "expected exposition text");
			}
		});
		it("should share one gather between concurrent requests", async function() {
			let calls = 0;
			controller.hooks.metrics.attach("test", async () => {
				calls += 1;
				await wait(100);
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
			controller.hosts = new SubscribableDatastore();
			controller.hostPairing = new HostPairingManager(controller);
			controller.generateHostToken = Controller.prototype.generateHostToken;
			controller.verifyHostToken = Controller.prototype.verifyHostToken;
			controller.wsServer.remoteAddr = req => req.socket.remoteAddress;
			adminToken = controller.users.signUserToken(controller.users.getByName("test"));
			playerToken = controller.users.signUserToken(controller.users.getByName("player"));
		});

		function post(path, body, headers = {}) {
			return fetch(`${endpoint}${path}`, {
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
			assert.equal(controller.hosts.size, 0, "a host was created");
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
				assert.equal(controller.hosts.size, 0);
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
				assert.equal(controller.hosts.size, 3);
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
				controller.hosts.set(new HostRecord(5, "five", "", new Map()));
				const hostToken = controller.generateHostToken(5);
				controller.hosts.delete(controller.hosts.get(5));

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
				for (const [method, path] of [
					["GET", `/poll?requestId=${id}`],
					["GET", `/poll/${id}`],
					["POST", `/poll/${id}`],
					["POST", `/${id}`],
					["GET", `/${id}`],
					["POST", `/cancel/${id}`],
				]) {
					const response = await fetch(`${endpoint}${path}`, { method });
					assert.equal(response.status, 404, `${method} ${path}`);
				}
				await assertResponse(await post("/poll", { requestId }), 202, { status: "pending" });
			});
		});

		describe("GET /api/host-pairing/check", function() {
			it("should respond with 200 for a valid host token", async function() {
				const { hostId, token } = controller.hostPairing.createHost("Host A");
				for (const headers of [
					{ "Authorization": `Bearer ${token}` },
					{ "X-Access-Token": token },
				]) {
					await assertResponse(await check(headers), 200, { valid: true });
				}
				assert(controller.hosts.has(hostId));
			});
			it("should respond with 200 for a host token from before the slave rename", async function() {
				const { hostId } = controller.hostPairing.createHost("Host A");
				const token = jwt.sign({ aud: "slave", slave: hostId }, controller.authSecret);
				await assertResponse(await check({ "Authorization": `Bearer ${token}` }), 200, { valid: true });
			});
			it("should respond with 401 without a valid host token", async function() {
				controller.hostPairing.createHost("Host A");
				assert.equal((await check({})).status, 401);
				assert.equal((await check({ "Authorization": "Bearer invalid" })).status, 401);
				assert.equal((await check({ "Authorization": `Bearer ${adminToken}` })).status, 401);
			});
			it("should respond with 401 once the host is revoked", async function() {
				const { hostId, token } = controller.hostPairing.createHost("Host A");
				await assertResponse(await check({ "Authorization": `Bearer ${token}` }), 200, { valid: true });
				controller.hosts.delete(controller.hosts.get(hostId));
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
	});
});
