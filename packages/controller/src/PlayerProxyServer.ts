import dgram from "node:dgram";
import { isIPv6 } from "node:net";

import * as lib from "@clusterio/lib";

import type Controller from "./Controller.js";
import type InstanceRecord from "./InstanceRecord.js";
import * as protocol from "./proxy_protocol.js";
import { MessageType } from "./proxy_protocol.js";

const SESSION_IDLE_TIMEOUT_MS = 30_000;
const INSTANCE_START_TIMEOUT_MS = 120_000;
const UPSTREAM_RETRY_INTERVAL_MS = 500;
const UPSTREAM_RETRY_COUNT = 20;
const PROBE_TIMEOUT_MS = 2_000;
const MAX_PENDING_PACKETS = 256;

/** Details about a player connecting through the proxy that is used to decide where to send them */
export interface PlayerProxyRouteRequest {
	/** Name the player connects with */
	username: string;
	/** Factorio version and build of the connecting client */
	version: protocol.ApplicationVersion;
	/** Address and port the client connects from */
	clientAddress: string;
	clientPort: number;
	/** Proxy port the client connected to */
	listenPort: number;
	/** Instance the proxy port is dedicated to, if any */
	portInstanceId?: number;
}

export interface PlayerProxyRoute {
	instanceId: number;
	address: string;
	port: number;
}

type Listener = {
	port: number;
	socket: dgram.Socket;
	instanceId?: number;
};

type ClientSession = {
	key: string;
	listener: Listener;
	clientAddress: string;
	clientPort: number;
	lastSeenMs: number;
	/** Raw ConnectionRequest received from the client */
	request?: protocol.ConnectionRequest & { buffer: Buffer };
	/** Request id the proxy answered the client with */
	proxyServerRequestId: number;
	username?: string;
	/** Fragments of the client's ConnectionRequestReplyConfirm by fragment number */
	confirmFragments: Map<number, Buffer>;
	confirmMessageId?: number;
	confirmServerRequestIdOffset?: number;
	state: "handshake" | "routing" | "connecting" | "connected" | "failed";
	route?: PlayerProxyRoute;
	upstream?: dgram.Socket;
	upstreamRetry?: ReturnType<typeof setInterval>;
	serverRequestId?: number;
	/** Packets received from the client before the upstream connection was ready */
	pending: Buffer[];
};

function randomUInt32() {
	return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/**
 * Strip the IPv4-mapped prefix from addresses so they can be used with udp4 sockets
 * @param address - Address to normalise.
 * @returns The address with any ::ffff: prefix removed.
 */
function normaliseAddress(address: string) {
	return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/**
 * UDP proxy for Factorio players
 *
 * Accepts connections from Factorio clients, completes the first step of the
 * connection handshake itself to learn the name and version of the player,
 * and then forwards the connection to the instance picked by the controller.
 * Stopped instances are started on demand.
 */
export default class PlayerProxyServer {
	private _listeners = new Map<number, Listener>();
	private _sessions = new Map<string, ClientSession>();
	private _cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private _closed = false;
	private _onInstancesUpdated = () => {
		this.syncListeners().catch(err => {
			this._logger.error(`Unexpected error syncing proxy ports:\n${err.stack}`);
		});
	};

	/** Last version and build seen from each instance's Factorio server */
	readonly serverVersions = new Map<number, protocol.ApplicationVersion>();

	constructor(
		private _controller: Controller,
		private _logger: lib.Logger,
		private _port: number,
	) {}

	get port() {
		return this._port;
	}

	/** Ports currently listened on, mapped to the instance they are dedicated to */
	get listeners(): ReadonlyMap<number, number | undefined> {
		return new Map([...this._listeners.values()].map(listener => [listener.port, listener.instanceId]));
	}

	async start() {
		if (this._closed) {
			return;
		}
		try {
			await this._listen(this._port);
		} catch (err: any) {
			// Not fatal so the rest of the controller still works, for example if a host on the
			// same machine runs an instance on the port.
			this._logger.error(
				`Failed to listen on player proxy port ${this._port}, players can't connect through the ` +
				`proxy: ${err.message}`
			);
		}
		this._controller.instances.records.on("update", this._onInstancesUpdated);
		await this.syncListeners();

		this._cleanupTimer = setInterval(() => this._cleanupSessions(), SESSION_IDLE_TIMEOUT_MS);
		this._cleanupTimer.unref();
	}

	async stop() {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._controller.instances.records.off("update", this._onInstancesUpdated);

		clearInterval(this._cleanupTimer);
		for (const session of this._sessions.values()) {
			this._closeSession(session);
		}
		this._sessions.clear();

		await Promise.all([...this._listeners.values()].map(listener => this._closeListener(listener)));
	}

	/**
	 * Open and close dedicated instance ports to match instance.player_proxy_port
	 */
	async syncListeners() {
		await this._syncListenersSerial.invoke();
	}

	private _syncListenersSerial = new lib.AsyncSerialMergingCallback(async () => {
		if (this._closed) {
			return;
		}

		const wanted = new Map<number, number>();
		for (const instance of this._controller.instances.values()) {
			const port = instance.config.get("instance.player_proxy_port");
			if (port === null || instance.isDeleted) {
				continue;
			}
			if (port === this._port) {
				this._logger.warn(`Instance ${instance.id} uses the main player proxy port ${port}, ignoring it`);
				continue;
			}
			if (wanted.has(port)) {
				this._logger.warn(
					`Instances ${wanted.get(port)} and ${instance.id} both use player proxy port ${port}, ` +
					`only routing it to ${wanted.get(port)}`
				);
				continue;
			}
			wanted.set(port, instance.id);
		}

		for (const listener of [...this._listeners.values()]) {
			if (listener.port === this._port) {
				continue;
			}
			const instanceId = wanted.get(listener.port);
			if (instanceId === undefined) {
				await this._closeListener(listener);
			} else {
				listener.instanceId = instanceId;
			}
		}

		for (const [port, instanceId] of wanted) {
			if (!this._listeners.has(port)) {
				try {
					await this._listen(port, instanceId);
				} catch (err: any) {
					this._logger.error(`Failed to listen on player proxy port ${port}: ${err.message}`);
				}
			}
		}
	});

	private async _listen(port: number, instanceId?: number) {
		const socket = dgram.createSocket("udp4");
		const listener: Listener = { port, socket, instanceId };
		await new Promise<void>((resolve, reject) => {
			socket.once("error", reject);
			socket.bind(port, () => {
				socket.off("error", reject);
				resolve();
			});
		});
		socket.on("error", err => {
			this._logger.error(`Player proxy socket on port ${port} errored: ${err.message}`);
		});
		socket.on("message", (message, rinfo) => {
			try {
				this._handleClientMessage(listener, message, rinfo);
			} catch (err: any) {
				this._logger.error(`Unexpected error handling player proxy packet:\n${err.stack}`);
			}
		});
		this._listeners.set(port, listener);
		this._logger.info(
			instanceId === undefined
				? `Player proxy listening on UDP ${port}`
				: `Player proxy listening on UDP ${port} for instance ${instanceId}`
		);
	}

	private async _closeListener(listener: Listener) {
		this._listeners.delete(listener.port);
		for (const session of [...this._sessions.values()]) {
			if (session.listener === listener) {
				this._closeSession(session);
			}
		}
		await new Promise<void>(resolve => listener.socket.close(() => resolve()));
	}

	private _handleClientMessage(listener: Listener, message: Buffer, rinfo: dgram.RemoteInfo) {
		if (this._closed) {
			return;
		}

		const type = protocol.messageType(message);
		const key = `${listener.port}|${rinfo.address}|${rinfo.port}`;
		let session = this._sessions.get(key);

		if (type === MessageType.ConnectionRequest) {
			let request: protocol.ConnectionRequest;
			try {
				request = protocol.parseConnectionRequest(message);
			} catch (err: any) {
				this._logger.verbose(`Ignoring malformed connection request: ${err.message}`);
				return;
			}

			// A different request id means the client started a new connection from the same socket,
			// which is what Factorio does after LuaPlayer::connect_to_server.
			if (session && session.request && session.request.clientRequestId !== request.clientRequestId) {
				this._closeSession(session);
				session = undefined;
			}
			if (!session) {
				session = this._createSession(key, listener, rinfo);
			}
			session.lastSeenMs = Date.now();
			this._handleConnectionRequest(session, request, message);
			return;
		}

		if (!session) {
			if (type === MessageType.Ping) {
				// Pings from the server browser are answered for the proxy itself
				this._replyToPing(listener, message, rinfo);
			}
			return;
		}
		session.lastSeenMs = Date.now();

		if (type === MessageType.ConnectionRequestReplyConfirm) {
			this._handleConfirm(session, message);
			return;
		}

		if (session.state === "connected") {
			this._sendUpstream(session, message);
		} else if (type === MessageType.Ping) {
			this._replyToPing(listener, message, rinfo);
		} else {
			this._queuePending(session, message);
		}
	}

	private _replyToPing(listener: Listener, message: Buffer, rinfo: dgram.RemoteInfo) {
		const reply = protocol.pingReplyFor(message);
		if (reply) {
			listener.socket.send(reply, rinfo.port, rinfo.address);
		}
	}

	private _createSession(key: string, listener: Listener, rinfo: dgram.RemoteInfo): ClientSession {
		const session: ClientSession = {
			key,
			listener,
			clientAddress: rinfo.address,
			clientPort: rinfo.port,
			lastSeenMs: Date.now(),
			proxyServerRequestId: randomUInt32(),
			confirmFragments: new Map(),
			state: "handshake",
			pending: [],
		};
		this._sessions.set(key, session);
		return session;
	}

	private _handleConnectionRequest(session: ClientSession, request: protocol.ConnectionRequest, buffer: Buffer) {
		session.request = { ...request, buffer };
		if (session.state !== "handshake" && session.state !== "routing") {
			return;
		}

		// Reply with the client's own version so it proceeds to send its username. If the instance
		// it ends up on runs a different version the connection will fail at that point instead.
		this._sendToClient(session, protocol.encodeConnectionRequestReply({
			version: request.version,
			clientRequestId: request.clientRequestId,
			serverRequestId: session.proxyServerRequestId,
			maxPacketSize: protocol.DEFAULT_MAX_PACKET_SIZE,
		}));
	}

	private _handleConfirm(session: ClientSession, message: Buffer) {
		let header: protocol.MessageHeader;
		try {
			header = protocol.parseHeader(message);
		} catch (err: any) {
			this._logger.verbose(`Ignoring malformed connection confirm: ${err.message}`);
			return;
		}

		const fragmentNumber = header.fragmented ? header.fragmentNumber! : 0;
		if (fragmentNumber === 0) {
			let confirm: protocol.ConnectionRequestReplyConfirm;
			try {
				confirm = protocol.parseConnectionRequestReplyConfirm(message);
			} catch (err: any) {
				this._logger.verbose(`Ignoring malformed connection confirm: ${err.message}`);
				return;
			}
			if (
				confirm.serverRequestId !== session.proxyServerRequestId
				&& confirm.serverRequestId !== session.serverRequestId
			) {
				return;
			}
			if (session.confirmMessageId !== undefined && session.confirmMessageId !== header.messageId) {
				// The client is sending a different confirm message, start over with it
				session.confirmFragments.clear();
			}
			session.confirmMessageId = header.messageId;
			session.confirmServerRequestIdOffset = confirm.serverRequestIdOffset;
			session.username = confirm.username;
		} else if (session.confirmMessageId !== undefined && header.messageId !== session.confirmMessageId) {
			return;
		}

		if (session.serverRequestId !== undefined) {
			// Resends of the confirm are passed on directly once the instance has answered
			this._sendUpstream(session, this._patchConfirm(session, message, fragmentNumber));
			return;
		}

		if (session.confirmFragments.size < MAX_PENDING_PACKETS) {
			session.confirmFragments.set(fragmentNumber, message);
		}

		if (session.state === "handshake" && session.username !== undefined && session.request) {
			session.state = "routing";
			this._routeSession(session).catch(err => {
				this._logger.error(`Unexpected error routing player ${session.username}:\n${err.stack}`);
				session.state = "failed";
			});
		}
	}

	private _patchConfirm(session: ClientSession, message: Buffer, fragmentNumber: number) {
		if (fragmentNumber !== 0 || session.confirmServerRequestIdOffset === undefined) {
			return message;
		}
		const patched = Buffer.from(message);
		patched.writeUInt32LE(session.serverRequestId!, session.confirmServerRequestIdOffset);
		return patched;
	}

	private async _routeSession(session: ClientSession) {
		const request: PlayerProxyRouteRequest = {
			username: session.username!,
			version: session.request!.version,
			clientAddress: session.clientAddress,
			clientPort: session.clientPort,
			listenPort: session.listener.port,
			portInstanceId: session.listener.instanceId,
		};

		const instanceId = await this._controller.resolvePlayerRoute(request);
		if (this._sessions.get(session.key) !== session) {
			return; // Session was replaced while routing
		}
		if (instanceId === undefined) {
			this._logger.warn(`No instance to route player ${request.username} to`);
			session.state = "failed";
			return;
		}

		const route = await this._resolveInstanceAddress(instanceId);
		if (this._sessions.get(session.key) !== session) {
			return;
		}
		if (!route) {
			this._logger.warn(`Unable to route player ${request.username} to instance ${instanceId}`);
			session.state = "failed";
			return;
		}

		this._logger.verbose(
			`Routing player ${request.username} (Factorio ${protocol.formatVersion(request.version)}) ` +
			`to instance ${instanceId} at ${route.address}:${route.port}`
		);
		session.route = route;
		session.state = "connecting";
		const upstream = dgram.createSocket(isIPv6(route.address) ? "udp6" : "udp4");
		session.upstream = upstream;
		upstream.on("message", data => {
			try {
				this._handleUpstreamMessage(session, data);
			} catch (err: any) {
				this._logger.error(`Unexpected error handling upstream packet:\n${err.stack}`);
			}
		});
		upstream.on("error", err => {
			this._logger.warn(`Upstream socket for ${request.username} errored: ${err.message}`);
			this._closeSession(session);
		});

		let attempts = 0;
		const sendRequest = () => {
			attempts += 1;
			if (attempts > UPSTREAM_RETRY_COUNT) {
				this._logger.warn(`Instance ${instanceId} did not answer connection of ${request.username}`);
				this._closeSession(session);
				return;
			}
			this._sendUpstream(session, session.request!.buffer);
		};
		sendRequest();
		session.upstreamRetry = setInterval(sendRequest, UPSTREAM_RETRY_INTERVAL_MS);
	}

	/**
	 * Find the address of an instance, starting it if it is stopped.
	 *
	 * @param instanceId - ID of the instance to look up.
	 * @returns address and port of the instance, or undefined if it's not reachable.
	 */
	private async _resolveInstanceAddress(instanceId: number): Promise<PlayerProxyRoute | undefined> {
		let instance = await this._ensureInstanceRunning(instanceId);
		if (!instance) {
			return undefined;
		}
		const hostId = instance.config.get("instance.assigned_host");
		const host = hostId !== null ? this._controller.hosts.get(hostId) : undefined;
		if (!host || !host.connected || !instance.gamePort) {
			return undefined;
		}
		// The address the host connected to the controller from is preferred as it is how the controller
		// reaches the host, the public address may not be reachable from inside the network.
		const address = normaliseAddress(host.remoteAddress || host.publicAddress);
		if (!address) {
			return undefined;
		}
		return { instanceId, address, port: instance.gamePort };
	}

	private async _ensureInstanceRunning(instanceId: number): Promise<Readonly<InstanceRecord> | undefined> {
		const instance = this._controller.instances.get(instanceId);
		if (!instance || instance.isDeleted || instance.config.get("instance.assigned_host") === null) {
			return undefined;
		}
		if (instance.status === "running") {
			return instance;
		}

		if (instance.status === "stopped") {
			this._logger.info(`Starting instance ${instanceId} for a player connecting through the proxy`);
			try {
				await this._controller.sendTo({ instanceId }, new lib.InstanceStartRequest());
			} catch (err: any) {
				this._logger.warn(`Failed to start instance ${instanceId}: ${err.message}`);
				return undefined;
			}
		}

		const deadline = Date.now() + INSTANCE_START_TIMEOUT_MS;
		while (Date.now() < deadline && !this._closed) {
			const current = this._controller.instances.get(instanceId);
			if (!current || current.isDeleted) {
				return undefined;
			}
			if (current.status === "running") {
				return current;
			}
			if (current.status === "stopped") {
				return undefined;
			}
			await lib.wait(500);
		}
		return undefined;
	}

	private _handleUpstreamMessage(session: ClientSession, data: Buffer) {
		if (this._sessions.get(session.key) !== session) {
			return;
		}

		if (protocol.messageType(data) === MessageType.ConnectionRequestReply) {
			if (session.serverRequestId !== undefined) {
				return;
			}
			let reply: protocol.ConnectionRequestReply;
			try {
				reply = protocol.parseConnectionRequestReply(data);
			} catch (err: any) {
				this._logger.warn(
					`Ignoring malformed reply from instance ${session.route!.instanceId}: ${err.message}`
				);
				return;
			}
			if (reply.clientRequestId !== session.request!.clientRequestId) {
				return;
			}

			clearInterval(session.upstreamRetry);
			session.upstreamRetry = undefined;
			session.serverRequestId = reply.serverRequestId;
			this.serverVersions.set(session.route!.instanceId, reply.version);
			if (!protocol.versionsEqual(reply.version, session.request!.version)) {
				this._logger.warn(
					`Player ${session.username} runs Factorio ${protocol.formatVersion(session.request!.version)} ` +
					`(build ${session.request!.version.build}) but instance ${session.route!.instanceId} runs ` +
					`${protocol.formatVersion(reply.version)} (build ${reply.version.build})`
				);
			}

			for (const [fragmentNumber, fragment] of [...session.confirmFragments].sort(([a], [b]) => a - b)) {
				this._sendUpstream(session, this._patchConfirm(session, fragment, fragmentNumber));
			}
			session.confirmFragments.clear();
			session.state = "connected";
			for (const pending of session.pending) {
				this._sendUpstream(session, pending);
			}
			session.pending = [];
			return;
		}

		this._sendToClient(session, data);
	}

	private _sendToClient(session: ClientSession, data: Buffer) {
		session.listener.socket.send(data, session.clientPort, session.clientAddress);
	}

	private _sendUpstream(session: ClientSession, data: Buffer) {
		if (session.upstream && session.route) {
			session.upstream.send(data, session.route.port, session.route.address);
		}
	}

	private _queuePending(session: ClientSession, message: Buffer) {
		if (session.pending.length >= MAX_PENDING_PACKETS) {
			session.pending.shift();
		}
		session.pending.push(message);
	}

	private _closeSession(session: ClientSession) {
		clearInterval(session.upstreamRetry);
		session.upstreamRetry = undefined;
		if (session.upstream) {
			session.upstream.close();
			session.upstream = undefined;
		}
		if (this._sessions.get(session.key) === session) {
			this._sessions.delete(session.key);
		}
	}

	private _cleanupSessions() {
		const now = Date.now();
		for (const session of [...this._sessions.values()]) {
			if (now - session.lastSeenMs > SESSION_IDLE_TIMEOUT_MS) {
				this._closeSession(session);
			}
		}
	}

	/**
	 * Ask a Factorio server which version and build it runs
	 *
	 * Sends a connection request and reads the version from the reply, the
	 * server forgets the request after its connection timeout.
	 *
	 * @param address - Address of the Factorio server.
	 * @param port - Game port of the Factorio server.
	 * @returns Version of the server, or undefined if it did not answer.
	 */
	static async probeVersion(address: string, port: number): Promise<protocol.ApplicationVersion | undefined> {
		const socket = dgram.createSocket(isIPv6(address) ? "udp6" : "udp4");
		const clientRequestId = randomUInt32();
		try {
			return await new Promise<protocol.ApplicationVersion | undefined>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS);
				socket.on("error", err => {
					clearTimeout(timeout);
					reject(err);
				});
				socket.on("message", data => {
					try {
						const reply = protocol.parseConnectionRequestReply(data);
						if (reply.clientRequestId === clientRequestId) {
							clearTimeout(timeout);
							resolve(reply.version);
						}
					} catch { /* not the reply we're waiting for */ }
				});
				// The server replies with its own version regardless of what the client sends.
				const version = { major: 0, minor: 0, sub: 0, build: 0 };
				socket.send(protocol.encodeConnectionRequest(version, clientRequestId), port, address);
			});
		} finally {
			socket.close();
		}
	}

	/**
	 * Find the version and build of an instance
	 *
	 * @param instanceId - ID of the instance.
	 * @returns version of the running instance, or the last version seen if it is stopped.
	 */
	async instanceVersion(instanceId: number) {
		const instance = this._controller.instances.get(instanceId);
		if (instance?.status === "running") {
			const route = await this._resolveInstanceAddress(instanceId);
			if (route) {
				const version = await PlayerProxyServer.probeVersion(route.address, route.port).catch(() => undefined);
				if (version) {
					this.serverVersions.set(instanceId, version);
				}
			}
		}
		return this.serverVersions.get(instanceId);
	}
}
