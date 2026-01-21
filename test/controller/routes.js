"use strict";
const assert = require("assert").strict;
const events = require("events");
const FormData = require("form-data");
const jwt = require("jsonwebtoken");
const http = require("http");

const { wait } = require("@clusterio/lib");
const routes = require("@clusterio/controller/dist/node/src/routes");
const mock = require("../mock");

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
	describe("/api/upload-save", function() {
		let endpoint;
		beforeEach(function() {
			endpoint = `http://localhost:${port}/api/upload-save`;
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
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "invalid" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
			controller.userManager.getByName("test").tokenValidAfter = Math.floor((Date.now() + 60e3) / 1000);
			response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 401);
		});

		it("should respond with 403 when user has insufficient permission", async function() {
			let response = await fetch(`${endpoint}?instance_id=123&filename=file.zip`, {
				method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "player" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				body: "totally a zip file",
			});
			assert.equal(response.status, 403);
		});

		let testToken = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));
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
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "text/plain" });
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				body: form.getBuffer(),
			});
			assert.equal(response.status, 400);
			assert.deepEqual(await response.json(), { request_errors: ["invalid file Content-Type"] });
			form = new FormData();
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "application/zip" });
			form.append("instance_id", "123");
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				body: form.getBuffer(),
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["instance_id must come before files uploaded"] }
			);
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", "totally a zip file", { filename: "test.txt", contentType: "application/zip" });
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				body: form.getBuffer(),
			});
			assert.equal(response.status, 400);
			assert.deepEqual(
				await response.json(), { request_errors: ["filename must end with .zip"] }
			);
			form = new FormData();
			form.append("instance_id", "invalid");
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "application/zip" });
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				body: form.getBuffer(),
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
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "application/zip" });
			response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				body: form.getBuffer(),
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
