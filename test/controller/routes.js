"use strict";
const assert = require("assert").strict;
const events = require("events");
const FormData = require("form-data");
const jwt = require("jsonwebtoken");
const http = require("http");
const phin = require("phin");

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
		it("should respond with 404 if stream doesn't exist", async function() {
			let response;
			response = await phin(`http://localhost:${port}/api/stream/01020304`);
			assert.equal(response.statusCode, 404);
			response = await phin({
				url: `http://localhost:${port}/api/stream/01020304`, method: "PUT",
				data: "test stream",
			});
			assert.equal(response.statusCode, 404);
		});
		it("should respond with 500 if stream times out", async function() {
			let stream = await routes.createProxyStream(controller.app);
			let response = await phin(`http://localhost:${port}/api/stream/${stream.id}`);
			assert.equal(response.statusCode, 500);
		});
		it("should passthrough a stream", async function() {
			let stream;
			let responses;
			stream = await routes.createProxyStream(controller.app);
			responses = await Promise.all([
				(async function() {
					await wait(100);
					return await phin({
						url: `http://localhost:${port}/api/stream/${stream.id}`, method: "PUT",
						data: "test content",
					});
				}()),
				phin(`http://localhost:${port}/api/stream/${stream.id}`),
			]);
			assert.equal(responses[0].statusCode, 200);
			assert.equal(responses[1].statusCode, 200);
			assert.equal(responses[1].body.toString(), "test content");
			stream = await routes.createProxyStream(controller.app);
			responses = await Promise.all([
				phin({
					url: `http://localhost:${port}/api/stream/${stream.id}`, method: "PUT",
					data: "test content",
				}),
				(async function() {
					await wait(100);
					return await phin(`http://localhost:${port}/api/stream/${stream.id}`);
				}()),
			]);
			assert.equal(responses[0].statusCode, 200);
			assert.equal(responses[1].statusCode, 200);
			assert.equal(responses[1].body.toString(), "test content");
		});
	});
	describe("/api/upload-save", function() {
		it("should respond with 401 with invalid token", async function() {
			let response;
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: { "Content-Type": "application/zip" },
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 401);
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": "invalid",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 401);
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "invalid" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 401);
			controller.userManager.users.get("test").tokenValidAfter = Math.floor((Date.now() + 60e3) / 1000);
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 401);
		});

		it("should respond with 403 when user has insufficient permission", async function() {
			let response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"Content-Type": "application/zip",
					"X-Access-Token": jwt.sign(
						{ aud: "user", user: "player" }, Buffer.from("TestSecretDoNotUse", "base64")
					),
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 403);
		});

		let testToken = jwt.sign({ aud: "user", user: "test" }, Buffer.from("TestSecretDoNotUse", "base64"));
		it("should respond with 415 if content type is missing or invalid", async function() {
			let response;
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 415);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["invalid Content-Type"] });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "invalid",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 415);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["invalid Content-Type"] });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=file.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "text/plain",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 415);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["invalid Content-Type"] });
		});

		it("should respond with 400 if invalid multipart request", async function() {
			let response;
			let form;
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "text/plain" });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				data: form.getBuffer(),
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["invalid file Content-Type"] });
			form = new FormData();
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "application/zip" });
			form.append("instance_id", "123");
			response = await phin({
				url: `http://localhost:${port}/api/upload-save`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				data: form.getBuffer(),
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(
				JSON.parse(response.body), { request_errors: ["instance_id must come before files uploaded"] }
			);
			form = new FormData();
			form.append("instance_id", "123");
			form.append("file", "totally a zip file", { filename: "test.txt", contentType: "application/zip" });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				data: form.getBuffer(),
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(
				JSON.parse(response.body), { request_errors: ["filename must end with .zip"] }
			);
			form = new FormData();
			form.append("instance_id", "invalid");
			form.append("file", "totally a zip file", { filename: "test.zip", contentType: "application/zip" });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				data: form.getBuffer(),
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(
				JSON.parse(response.body), { request_errors: ["invalid instance_id"] }
			);
		});

		it("should respond with 400 if invalid file request", async function() {
			let response;
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["Missing or invalid filename parameter"] });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=test.txt`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(JSON.parse(response.body), { request_errors: ["filename must end with .zip"] });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?filename=test.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 400);
			assert.deepEqual(
				JSON.parse(response.body), { request_errors: ["Missing or invalid instance_id parameter"] }
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
			response = await phin({
				url: `http://localhost:${port}/api/upload-save`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					...form.getHeaders(),
				},
				data: form.getBuffer(),
			});
			assert.equal(response.statusCode, 500);
			assert.deepEqual(JSON.parse(response.body), { errors: ["Something went wrong"], request_errors: [] });
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=test.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 500);
			assert.deepEqual(JSON.parse(response.body), { errors: ["Something went wrong"], request_errors: [] });
			controller.sendToHostByInstanceId = async (request) => {
				await new Promise(() => {});
			};
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=test.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.equal(response.statusCode, 500);
			assert.deepEqual(
				JSON.parse(response.body), { errors: ["Timed out establishing stream to host"], request_errors: [] }
			);
		});

		it("should complete a valid transfer", async function() {
			controller.sendToHostByInstanceId = async (request) => {
				let stream = await phin({
					url: `http://localhost:${port}/api/stream/${request.streamId}`,
				});
				assert.equal(stream.body.toString(), "totally a zip file");
				return request.name;
			};
			let response;
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=test.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/zip",
				},
				data: "totally a zip file",
			});
			assert.deepEqual(JSON.parse(response.body), { saves: ["test.zip"] });
			assert.equal(response.statusCode, 200);
		});
		it("should complete a valid transfer with non-standerd mime type", async function() {
			controller.sendToHostByInstanceId = async (request) => {
				let stream = await phin({
					url: `http://localhost:${port}/api/stream/${request.streamId}`,
				});
				assert.equal(stream.body.toString(), "totally a zip file");
				return request.name;
			};
			let response;
			response = await phin({
				url: `http://localhost:${port}/api/upload-save?instance_id=123&filename=test.zip`, method: "POST",
				headers: {
					"X-Access-Token": testToken,
					"Content-Type": "application/x-zip-compressed",
				},
				data: "totally a zip file",
			});
			assert.deepEqual(JSON.parse(response.body), { saves: ["test.zip"] });
			assert.equal(response.statusCode, 200);
		});
	});
});
