import assert from "node:assert/strict";
import dgram from "node:dgram";
import events from "node:events";
import * as lib from "@clusterio/lib";

import { Controller, HostRecord, InstanceRecord, PlayerProxyServer, proxyProtocol } from "@clusterio/controller";

const { MessageType } = proxyProtocol;
const clientVersion = { major: 2, minor: 0, sub: 72, build: 84292 };
const defaultMods = [
	{ name: "base", version: "2.0.72" },
	{ name: "space-age", version: "2.0.72" },
	{ name: "big-mod", version: "1.300.2" },
];

/**
 * Encode a ConnectionRequestReplyConfirm the way a Factorio client does
 *
 * @param {object} options - fields of the message.
 * @returns {Buffer[]} the message split into the given number of fragments.
 */
function encodeConfirm({
	clientRequestId, serverRequestId, username, messageId = 1, fragments = 1, mods = defaultMods,
}) {
	const payload = new proxyProtocol.BufferWriter();
	const writeString = text => {
		const bytes = Buffer.from(text);
		payload.writeUInt8(bytes.length);
		for (const byte of bytes) {
			payload.writeUInt8(byte);
		}
	};
	payload.writeUInt32LE(clientRequestId);
	payload.writeUInt32LE(serverRequestId);
	payload.writeUInt32LE(1234); // instanceID
	writeString(username);
	writeString(""); // password
	writeString("server-key");
	writeString("1700000000");
	payload.writeUInt32LE(0x11111111); // coreChecksum
	payload.writeUInt32LE(0x22222222); // prototypeListChecksum
	payload.writeUInt8(mods.length);
	for (const mod of mods) {
		writeString(mod.name);
		for (const part of mod.version.split(".")) {
			payload.writeSpaceOptimizedUInt16(Number(part));
		}
		payload.writeUInt32LE(0x33333333); // crc
	}
	// Stands in for the startup mod settings
	for (let i = 0; i < 40; i++) {
		payload.writeUInt8(i);
	}
	const body = payload.toBuffer();

	if (fragments === 1) {
		return [Buffer.concat([Buffer.from([MessageType.ConnectionRequestReplyConfirm, messageId, 0]), body])];
	}
	const size = Math.ceil(body.length / fragments);
	const result = [];
	for (let i = 0; i < fragments; i++) {
		const last = i === fragments - 1;
		const header = Buffer.from([
			MessageType.ConnectionRequestReplyConfirm | 0x40 | (last ? 0x80 : 0),
			messageId, 0, i,
		]);
		result.push(Buffer.concat([header, body.subarray(i * size, (i + 1) * size)]));
	}
	return result;
}

/** Minimal stand in for a Factorio server's side of the handshake */
class FakeFactorioServer {
	constructor(version = clientVersion) {
		this.version = version;
		this.serverRequestId = 0xabcd1234;
		this.received = [];
		this.socket = dgram.createSocket("udp4");
		this.socket.on("message", (message, rinfo) => this.handle(message, rinfo));
	}

	async start() {
		this.socket.bind(0, "127.0.0.1");
		await events.once(this.socket, "listening");
		this.port = this.socket.address().port;
	}

	handle(message, rinfo) {
		this.received.push(message);
		const type = proxyProtocol.messageType(message);
		if (type === MessageType.ConnectionRequest) {
			const request = proxyProtocol.parseConnectionRequest(message);
			this.socket.send(proxyProtocol.encodeConnectionRequestReply({
				version: this.version,
				clientRequestId: request.clientRequestId,
				serverRequestId: this.serverRequestId,
				maxPacketSize: 508,
			}), rinfo.port, rinfo.address);
		} else if (type === MessageType.ConnectionRequestReplyConfirm) {
			const header = proxyProtocol.parseHeader(message);
			if (!header.fragmented || header.lastFragment) {
				const accept = Buffer.from([MessageType.ConnectionAcceptOrDeny, this.port & 0xff]);
				this.socket.send(accept, rinfo.port, rinfo.address);
			}
		} else if (type === 6) { // ClientToServerHeartbeat
			this.socket.send(Buffer.from([7, ...message.subarray(1)]), rinfo.port, rinfo.address);
		}
	}

	confirms() {
		return this.received.filter(m => proxyProtocol.messageType(m) === MessageType.ConnectionRequestReplyConfirm);
	}

	close() {
		this.socket.close();
	}
}

class FakeClient {
	constructor(proxyPort) {
		this.proxyPort = proxyPort;
		this.socket = dgram.createSocket("udp4");
		this.queue = [];
		this.waiters = [];
		this.socket.on("message", message => {
			const waiter = this.waiters.shift();
			if (waiter) {
				waiter(message);
			} else {
				this.queue.push(message);
			}
		});
	}

	async start() {
		this.socket.bind(0, "127.0.0.1");
		await events.once(this.socket, "listening");
	}

	send(message) {
		this.socket.send(message, this.proxyPort, "127.0.0.1");
	}

	receive(timeoutMs = 2000) {
		if (this.queue.length) {
			return Promise.resolve(this.queue.shift());
		}
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.waiters.splice(this.waiters.indexOf(waiter), 1);
				reject(new Error("Timed out waiting for packet"));
			}, timeoutMs);
			const waiter = message => {
				clearTimeout(timeout);
				resolve(message);
			};
			this.waiters.push(waiter);
		});
	}

	/** Perform the handshake and return the first packet forwarded from the server */
	async connect(username, { clientRequestId = 42, fragments = 1 } = {}) {
		this.send(proxyProtocol.encodeConnectionRequest(clientVersion, clientRequestId));
		const reply = proxyProtocol.parseConnectionRequestReply(await this.receive());
		for (const fragment of encodeConfirm({
			clientRequestId, serverRequestId: reply.serverRequestId, username, messageId: clientRequestId, fragments,
		})) {
			this.send(fragment);
		}
		return { reply, accept: await this.receive() };
	}

	close() {
		this.socket.close();
	}
}

async function freePort() {
	const socket = dgram.createSocket("udp4");
	socket.bind(0, "127.0.0.1");
	await events.once(socket, "listening");
	const { port } = socket.address();
	socket.close();
	return port;
}

describe("controller/proxy_protocol", function () {
	it("should round trip a connection request", function () {
		const buffer = proxyProtocol.encodeConnectionRequest({ major: 2, minor: 1, sub: 300, build: 90000 }, 7, 5);
		const request = proxyProtocol.parseConnectionRequest(buffer);
		assert.deepEqual(request.version, { major: 2, minor: 1, sub: 300, build: 90000 });
		assert.equal(request.clientRequestId, 7);
		assert.equal(request.header.messageId, 5);
	});

	it("should round trip a connection request reply", function () {
		const reply = { version: clientVersion, clientRequestId: 1, serverRequestId: 0xffffffff, maxPacketSize: 508 };
		const encoded = proxyProtocol.encodeConnectionRequestReply(reply);
		assert.deepEqual(proxyProtocol.parseConnectionRequestReply(encoded), reply);
	});

	it("should parse confirms in the header", function () {
		const buffer = Buffer.from([MessageType.ConnectionRequestReplyConfirm, 3, 0x80, 2, 1, 0, 0, 0, 2, 0, 0, 0]);
		const header = proxyProtocol.parseHeader(buffer);
		assert.equal(header.messageId, 3);
		assert.deepEqual(header.confirms, [1, 2]);
		assert.equal(header.payloadOffset, buffer.length);
	});

	it("should parse the first fragment of a fragmented confirm", function () {
		const [first, second] = encodeConfirm({
			clientRequestId: 1, serverRequestId: 2, username: "Player", fragments: 2,
		});
		const confirm = proxyProtocol.parseConnectionRequestReplyConfirm(first);
		assert.equal(confirm.username, "Player");
		assert.equal(first.readUInt32LE(confirm.serverRequestIdOffset), 2);
		assert.throws(() => proxyProtocol.parseConnectionRequestReplyConfirm(second), /first fragment/);
	});

	it("should read the mods from a fragmented confirm", function () {
		const fragments = encodeConfirm({ clientRequestId: 1, serverRequestId: 2, username: "Player", fragments: 3 });
		assert.deepEqual(proxyProtocol.parseConfirmMods(proxyProtocol.joinPayload(fragments)), defaultMods);
	});

	it("should reject truncated messages", function () {
		assert.throws(() => proxyProtocol.parseConnectionRequest(Buffer.from([MessageType.ConnectionRequest, 0])));
	});

	it("should build a ping reply", function () {
		const reply = proxyProtocol.pingReplyFor(Buffer.from([0x20, 5, 1]));
		assert.deepEqual(reply, Buffer.from([MessageType.PingReply, 5, 1]));
		assert.equal(proxyProtocol.pingReplyFor(Buffer.from([0])), undefined);
	});
});

describe("controller/PlayerProxyServer", function () {
	let controller;
	let proxy;
	let servers;
	let clients;
	let proxyPort;

	function addInstance(id, server, status = "running", fields = {}) {
		const config = new lib.InstanceConfig("controller", {
			"instance.id": id,
			"instance.name": `Instance ${id}`,
			"instance.assigned_host": 1,
			...fields,
		});
		controller.instances.records.set(new InstanceRecord(config, status, server?.port));
	}

	async function newClient(port = proxyPort) {
		const client = new FakeClient(port);
		await client.start();
		clients.push(client);
		return client;
	}

	beforeEach(async function () {
		const config = new lib.ControllerConfig("controller", { "controller.name": "Test" });
		controller = new Controller(lib.logger, [], config);
		controller.hosts.set(new HostRecord(1, "Host", "2.0.0", new Map(), true, "::ffff:127.0.0.1"));
		servers = [new FakeFactorioServer(), new FakeFactorioServer()];
		await Promise.all(servers.map(server => server.start()));
		addInstance(1, servers[0]);
		addInstance(2, servers[1]);
		clients = [];
		proxyPort = await freePort();
		proxy = new PlayerProxyServer(controller, lib.logger, proxyPort);
		await proxy.start();
	});

	afterEach(async function () {
		await proxy.stop();
		servers.forEach(server => server.close());
		clients.forEach(client => client.close());
	});

	it("should complete the handshake through the proxy", async function () {
		const client = await newClient();
		const { reply, accept } = await client.connect("Player", { fragments: 3 });

		assert.deepEqual(reply.version, clientVersion);
		assert.equal(reply.maxPacketSize, 508);
		assert.equal(accept[0], MessageType.ConnectionAcceptOrDeny);

		const confirms = servers[0].confirms();
		assert.equal(confirms.length, 3);
		const confirm = proxyProtocol.parseConnectionRequestReplyConfirm(confirms[0]);
		assert.equal(confirm.serverRequestId, servers[0].serverRequestId);
		assert.equal(confirm.username, "Player");

		client.send(Buffer.from([6, 1, 2, 3]));
		assert.deepEqual(await client.receive(), Buffer.from([7, 1, 2, 3]));
		assert.equal(proxy.serverVersions.get(1).build, clientVersion.build);
	});

	it("should route once the whole confirm has arrived", async function () {
		const requests = [];
		controller.hooks.playerProxyRoute.attach("test", request => {
			requests.push(request);
			return 1;
		});
		const client = await newClient();
		client.send(proxyProtocol.encodeConnectionRequest(clientVersion, 7));
		const reply = proxyProtocol.parseConnectionRequestReply(await client.receive());
		const [first, second, third] = encodeConfirm({
			clientRequestId: 7, serverRequestId: reply.serverRequestId, username: "Player", messageId: 7, fragments: 3,
		});
		client.send(third);
		client.send(first);
		await lib.wait(50);
		assert.equal(requests.length, 0, "routed before all fragments arrived");
		client.send(second);
		assert.equal((await client.receive())[0], MessageType.ConnectionAcceptOrDeny);
		assert.deepEqual(requests[0].mods, defaultMods);
		assert.equal(servers[0].confirms().length, 3);
	});

	it("should route by the playerProxyRoute hook", async function () {
		controller.hooks.playerProxyRoute.attach("test", request => {
			assert.deepEqual(request.version, clientVersion);
			return request.username === "Special" ? 2 : undefined;
		});
		const client = await newClient();
		await client.connect("Special");
		assert.equal(servers[1].confirms().length, 1);
		assert.equal(servers[0].confirms().length, 0);
	});

	it("should reroute a new connection from the same socket", async function () {
		let target = 1;
		controller.hooks.playerProxyRoute.attach("test", () => target);
		const client = await newClient();
		await client.connect("Player", { clientRequestId: 1 });
		assert.equal(servers[0].confirms().length, 1);

		target = 2;
		await client.connect("Player", { clientRequestId: 2 });
		assert.equal(servers[1].confirms().length, 1);
	});

	it("should answer pings for clients that are not connected", async function () {
		const client = await newClient();
		client.send(Buffer.from([MessageType.Ping, 9, 0]));
		assert.deepEqual(await client.receive(), Buffer.from([MessageType.PingReply, 9, 0]));
	});

	it("should route dedicated instance ports to their instance", async function () {
		const port = await freePort();
		controller.instances.getMutable(2).config.set("instance.player_proxy_port", port);
		controller.instances.records.set(controller.instances.getMutable(2));
		await proxy.syncListeners();
		assert.equal(proxy.listeners.get(port), 2);

		const client = await newClient(port);
		await client.connect("Player");
		assert.equal(servers[1].confirms().length, 1);

		controller.instances.getMutable(2).config.set("instance.player_proxy_port", null);
		await proxy.syncListeners();
		assert.equal(proxy.listeners.has(port), false);
	});

	it("should start a stopped instance", async function () {
		controller.instances.getMutable(2).status = "stopped";
		controller.instances.getMutable(2).gamePort = undefined;
		controller.hooks.playerProxyRoute.attach("test", () => 2);
		const started = [];
		controller.sendTo = async (dst, message) => {
			assert(message instanceof lib.InstanceStartRequest);
			started.push(dst.instanceId);
			const instance = controller.instances.getMutable(dst.instanceId);
			instance.status = "running";
			instance.gamePort = servers[1].port;
		};
		const client = await newClient();
		await client.connect("Player");
		assert.deepEqual(started, [2]);
	});

	it("should probe the version of a server", async function () {
		servers[0].version = { major: 2, minor: 1, sub: 5, build: 12345 };
		assert.deepEqual(await PlayerProxyServer.probeVersion("127.0.0.1", servers[0].port), servers[0].version);
		assert.deepEqual(await proxy.instanceVersion(1), servers[0].version);
	});
});

describe("controller/Controller.resolvePlayerRoute()", function () {
	let controller;

	beforeEach(function () {
		const config = new lib.ControllerConfig("controller", { "controller.name": "Test" });
		controller = new Controller(lib.logger, [], config);
		for (const [id, status] of [[1, "running"], [2, "stopped"], [3, "stopped"], [4, "stopped"]]) {
			controller.instances.records.set(new InstanceRecord(new lib.InstanceConfig("controller", {
				"instance.id": id, "instance.assigned_host": 1,
			}), status));
		}
		controller.instances.records.set(new InstanceRecord(new lib.InstanceConfig("controller", {
			"instance.id": 5,
		}), "unassigned"));
	});

	const request = (fields = {}) => ({
		username: "player", version: clientVersion, clientAddress: "127.0.0.1", clientPort: 1, listenPort: 1, ...fields,
	});

	it("should prefer hooks, then dedicated port, then last instance, then default", async function () {
		const user = controller.users.getOrCreateUser("Player");
		user.instanceStats.set(3, Object.assign(new lib.PlayerStats(), { lastJoinAt: new Date(2000) }));
		user.instanceStats.set(4, Object.assign(new lib.PlayerStats(), { lastJoinAt: new Date(1000) }));
		controller.config.set("controller.player_proxy_default_instance_id", 4);

		assert.equal(await controller.resolvePlayerRoute(request()), 3);
		assert.equal(await controller.resolvePlayerRoute(request({ username: "other" })), 4);
		assert.equal(await controller.resolvePlayerRoute(request({ portInstanceId: 2 })), 2);
		controller.hooks.playerProxyRoute.attach("test", () => 4);
		assert.equal(await controller.resolvePlayerRoute(request({ portInstanceId: 2 })), 4);
	});

	it("should give the public address of the proxy", function () {
		assert.equal(controller.getPlayerProxyAddress(), undefined, "proxy disabled");
		controller.playerProxyServer = { port: 34197 };
		assert.equal(controller.getPlayerProxyAddress(), undefined, "no address configured");
		controller.config.set("controller.public_url", "https://cluster.example/");
		assert.equal(controller.getPlayerProxyAddress(), "cluster.example:34197");
		assert.equal(controller.getPlayerProxyAddress(34200), "cluster.example:34200");
		controller.config.set("controller.player_proxy_public_address", "play.example:5000");
		assert.equal(controller.getPlayerProxyAddress(), "play.example:5000");
		assert.equal(controller.getPlayerProxyAddress(34200), "play.example:34200");
		controller.config.set("controller.player_proxy_public_address", "[::1]");
		assert.equal(controller.getPlayerProxyAddress(34200), "[::1]:34200");
		controller.config.set("controller.player_proxy_public_address", "::1");
		assert.equal(controller.getPlayerProxyAddress(34200), "[::1]:34200");
	});

	it("should skip instances that can't be routed to", async function () {
		controller.hooks.playerProxyRoute.attach("test", () => 5);
		assert.equal(await controller.resolvePlayerRoute(request({ portInstanceId: 99 })), 1);
	});
});
