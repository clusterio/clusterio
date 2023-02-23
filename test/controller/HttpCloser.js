"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const http = require("http");
const https = require("https");
const util = require("util");

const phin = require("phin");

const { wait } = require("@clusterio/lib/helpers");
const HttpCloser = require("@clusterio/controller/src/HttpCloser");

// Time to wait during async operations to ensure they happened in order.
const tick = 20;

function serverSuite(proto) {
	let api = proto === "http" ? http : https;
	let server;
	let serverOptions = {};
	let clientOptions = {};
	let closer;
	let isClosed;
	let addr;

	function setClosed() {
		isClosed = true;
	}

	async function get(url, options = {}) {
		let core = { ...clientOptions, ...(options.core || {}) };
		return await phin({ ...options, url, core });
	}

	before(async function() {
		if (proto === "https") {
			serverOptions.key = await fs.readFile("test/file/tls/key.pem");
			serverOptions.cert = await fs.readFile("test/file/tls/cert.pem");
			clientOptions.ca = serverOptions.cert;
		}
	});
	beforeEach(async function() {
		isClosed = false;
		server = api.createServer(serverOptions);
		server.unref();
		server.on("close", setClosed);
		closer = new HttpCloser(server);
		await util.promisify(server.listen.bind(server))();
		addr = `${proto}://localhost:${server.address().port}/`;
	});

	afterEach(function() {
		server.off("close", setClosed);
	});

	it("should close the server", async function() {
		await closer.close();
		assert(isClosed, "Server was not closed");
	});

	it("should reject with error if the close fails", async function() {
		await closer.close();
		await assert.rejects(closer.close(), { code: "ERR_SERVER_NOT_RUNNING" });
	});

	it("should gracefully let pending requests finish", async function() {
		server.on("request", (request, response) => {
			setTimeout(() => { response.end("ok-1"); }, 3*tick);
		});

		let request = get(addr);
		request.catch(() => {});
		await wait(tick);
		await closer.close();

		let response = await request;
		assert.equal(response.statusCode, 200, "non-200 response status code");
		assert.equal(response.body.toString(), "ok-1", "response content does not match expected");
	});

	it("should set Connection header to close for pending requests", async function() {
		server.on("request", (request, response) => {
			setTimeout(() => { response.end("ok-2"); }, 3*tick);
			assert.equal(request.headers.connection, "keep-alive", "Connection not kept alive");
		});

		let agent = new api.Agent({ keepAlive: true });
		let request = get(addr, { core: { agent }});
		request.catch(() => {});
		await wait(tick);
		await closer.close();

		let response = await request;
		assert.equal(response.statusCode, 200, "non-200 response status code");
		assert.equal(response.body.toString(), "ok-2", "response content does not match expected");
		assert.equal(response.headers.connection, "close", "response Connection header not set to close");
	});

	it("should gracefully close open connections", async function() {
		server.on("request", (request, response) => {
			response.end("ok-3");
			assert.equal(request.headers.connection, "keep-alive", "Connection not kept alive");
		});

		let agent = new api.Agent({ keepAlive: true });
		let request = get(addr, { core: { agent }});
		request.catch(() => {});
		await wait(tick);
		await closer.close();

		let response = await request;
		assert.equal(response.statusCode, 200, "Request replied with non-200 status code");
		assert.equal(response.body.toString(), "ok-3", "Request content does not match expected");
	});

	it("should refuse connection if request sent after starting closure", async function() {
		this.timeout(4000); // On Windows this test takes 2 seconds for some reason.
		server.on("request", (request, response) => {
			setTimeout(() => { response.end("ok-4"); }, 3*tick);
		});

		let request = get(addr);
		request.catch(() => {});
		await wait(tick);
		let close = closer.close();

		let agent = new api.Agent({ keepAlive: true });
		await assert.rejects(get(addr, { core: { agent }}), { code: "ECONNREFUSED" });

		let response = await request;
		assert.equal(response.statusCode, 200, "non-200 response status code");
		assert.equal(response.body.toString(), "ok-4", "response content does not match expected");

		await close;
	});

	it("should close connection after in-flight request is over", async function() {
		server.on("request", (request, response) => {
			response.write("ok");
			setTimeout(() => { response.end("-5"); }, 3*tick);
			assert.equal(request.headers.connection, "keep-alive", "Connection not kept alive");
		});

		let agent = new api.Agent({ keepAlive: true });
		let request = get(addr, { core: { agent }});
		request.catch(() => {});
		await wait(tick);
		await closer.close();

		let response = await request;
		assert.equal(response.statusCode, 200, "non-200 response status code");
		assert.equal(response.body.toString(), "ok-5", "response content does not match expected");
	});

	it("should cause connection reset for qeueud request after in-flight request", async function() {
		server.on("request", (request, response) => {
			response.write("ok");
			setTimeout(() => { response.end("-6"); }, 3*tick);
			assert.equal(request.headers.connection, "keep-alive", "Connection not kept alive");
		});

		let agent = new api.Agent({ keepAlive: true, maxSockets: 1 });
		let request = get(addr, { core: { agent }});
		request.catch(() => {});
		let droppedRequest = get(addr, { core: { agent }});
		droppedRequest.catch(() => {});
		await wait(tick);
		await closer.close();

		let response = await request;
		assert.equal(response.statusCode, 200, "non-200 response status code");
		assert.equal(response.body.toString(), "ok-6", "response content does not match expected");
		await assert.rejects(droppedRequest, { code: "ECONNRESET" });
	});

	it("should abort requests that take too long to respond", async function() {
		server.on("request", (request, response) => {
			response.write("ok");
			setTimeout(() => { response.end("-7"); }, 5*tick);
		});

		let request = get(addr);
		request.catch(() => {});
		await wait(tick);
		await closer.close(tick*2);

		// Due to a bug in phin [https://github.com/ethanent/phin/issues/59]
		// the request Promise never settles.
		// TODO: uncomment when bug is fixed in phin.
		// await assert.rejects(request);
	});
}

describe("controller/src/HttpCloser.js", function() {
	describe("class HttpCloser", function() {
		describe("constructor()", function() {
			it("should throw if not passed a Server instance", function() {
				assert.throws(() => new HttpCloser({}));
			});
		});
		for (let proto of ["http", "https"]) {
			describe(`${proto} server`, function() {
				serverSuite(proto);
			});
		}
	});
});
