import dgram from "dgram";

import * as lib from "@clusterio/lib";

import type Controller from "./Controller";

const TYPE_MASK = 0x1f;
const FLAG_MASK = 0xe0;

const TYPE_CONNECTION_REQUEST = 2;
const TYPE_CONNECTION_REQUEST_REPLY = 3;
const TYPE_CONNECTION_REQUEST_REPLY_CONFIRM = 4;

const SESSION_IDLE_TIMEOUT_MS = 30_000;
const MAX_PENDING_PACKETS = 64;
const MAX_PACKET_SIZE = 1400;

type ClientKey = string;

type RouteTarget = {
	hostId: number;
	instanceId: number;
	publicAddress: string;
	gamePort: number;
};

type ClientSession = {
	clientAddress: string;
	clientPort: number;
	lastSeenMs: number;
	pending: Buffer[];
	upstream: dgram.Socket | null;
	route: RouteTarget | null;
	requestBuffer?: Buffer;
	requestFlags?: number;
	requestMessageIdAndFlags?: number;
	requestVersion?: ApplicationVersion;
	clientRequestId?: number;
	proxyServerId?: number;
	pendingConfirm?: Buffer;
	confirmServerIdOffset?: number;
	serverConnectionId?: number;
	username?: string;
	activating?: Promise<void>;
};

type ApplicationVersion = {
	major: number;
	minor: number;
	sub: number;
	build: number;
};

class BufferReader {
	private _offset = 0;
	constructor(private _buffer: Buffer) {}

	get offset() {
		return this._offset;
	}

	readUInt8() {
		const value = this._buffer.readUInt8(this._offset);
		this._offset += 1;
		return value;
	}

	readUInt16LE() {
		const value = this._buffer.readUInt16LE(this._offset);
		this._offset += 2;
		return value;
	}

	readUInt32LE() {
		const value = this._buffer.readUInt32LE(this._offset);
		this._offset += 4;
		return value;
	}

	readSpaceOptimized() {
		const value = this.readUInt8();
		if (value === 0xff) {
			return this.readUInt16LE();
		}
		return value;
	}

	readContainerSize() {
		const value = this.readUInt8();
		if (value === 0xff) {
			return this.readUInt32LE();
		}
		return value;
	}

	readBytes(length: number) {
		const start = this._offset;
		const end = start + length;
		if (end > this._buffer.length) {
			throw new Error("Buffer too short");
		}
		this._offset = end;
		return this._buffer.slice(start, end);
	}
}

class BufferWriter {
	private _parts: Buffer[] = [];

	writeUInt8(value: number) {
		const buf = Buffer.allocUnsafe(1);
		buf.writeUInt8(value, 0);
		this._parts.push(buf);
	}

	writeUInt16LE(value: number) {
		const buf = Buffer.allocUnsafe(2);
		buf.writeUInt16LE(value, 0);
		this._parts.push(buf);
	}

	writeUInt32LE(value: number) {
		const buf = Buffer.allocUnsafe(4);
		buf.writeUInt32LE(value >>> 0, 0);
		this._parts.push(buf);
	}

	writeSpaceOptimized(value: number) {
		if (value >= 0xff) {
			this.writeUInt8(0xff);
			this.writeUInt16LE(value);
		} else {
			this.writeUInt8(value);
		}
	}

	concat() {
		return Buffer.concat(this._parts);
	}
}

function clientKey(address: string, port: number): ClientKey {
	return `${address}:${port}`;
}

export default class PlayerProxyServer {
	private _socket: dgram.Socket | null = null;
	private _sessions = new Map<ClientKey, ClientSession>();
	private _cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private _closed = false;

	constructor(
		private _controller: Controller,
		private _logger: lib.Logger,
		private _port: number,
	) {}

	async start() {
		if (this._socket || this._closed) {
			return;
		}

		const socket = dgram.createSocket("udp4");
		this._socket = socket;
		socket.on("message", this._handleClientMessage.bind(this));
		socket.on("error", err => {
			this._logger.error(`Player proxy socket error: ${err.message}`);
			this.stop().catch(() => {});
		});

		await new Promise<void>((resolve, reject) => {
			socket.once("listening", resolve);
			socket.once("error", reject);
			socket.bind(this._port, "0.0.0.0");
		});

		this._cleanupTimer = setInterval(() => this._cleanupSessions(), SESSION_IDLE_TIMEOUT_MS);
		this._cleanupTimer.unref();
		this._logger.info(`Player proxy listening on UDP ${this._port}`);
	}

	async stop() {
		if (this._closed) {
			return;
		}
		this._closed = true;

		if (this._cleanupTimer) {
			clearInterval(this._cleanupTimer);
			this._cleanupTimer = undefined;
		}

		for (const session of this._sessions.values()) {
			session.upstream?.close();
		}
		this._sessions.clear();

		if (this._socket) {
			await new Promise<void>(resolve => this._socket!.close(() => resolve()));
			this._socket = null;
		}
	}

	private _handleClientMessage(message: Buffer, rinfo: dgram.RemoteInfo) {
		if (this._closed || !this._socket) {
			return;
		}

		const key = clientKey(rinfo.address, rinfo.port);
		let session = this._sessions.get(key);
		if (!session) {
			session = this._createSession(rinfo.address, rinfo.port);
			this._sessions.set(key, session);
		}
		session.lastSeenMs = Date.now();

		let type: number;
		try {
			type = message.readUInt8(0) & TYPE_MASK;
		} catch {
			return;
		}

		if (type === TYPE_CONNECTION_REQUEST) {
			this._handleConnectionRequest(session, message);
			return;
		}

		if (type === TYPE_CONNECTION_REQUEST_REPLY_CONFIRM) {
			this._handleConnectionRequestReplyConfirm(session, message);
			return;
		}

		if (!session.route || !session.upstream) {
			this._queuePending(session, message);
			return;
		}

		this._flushPending(session);
		session.upstream.send(message, session.route.gamePort, session.route.publicAddress);
	}

	private _createSession(address: string, port: number): ClientSession {
		return {
			clientAddress: address,
			clientPort: port,
			lastSeenMs: Date.now(),
			pending: [],
			upstream: null,
			route: null,
		};
	}

	private _handleConnectionRequest(session: ClientSession, message: Buffer) {
		let parsed: {
			flags: number;
			messageIdAndFlags: number;
			version: ApplicationVersion;
			requestId: number;
		};
		try {
			parsed = this._parseConnectionRequest(message);
		} catch (err: any) {
			this._logger.warn(`Failed to parse connection request: ${err.message ?? err}`);
			return;
		}

		session.requestBuffer = message;
		session.requestFlags = parsed.flags;
		session.requestMessageIdAndFlags = parsed.messageIdAndFlags;
		session.requestVersion = parsed.version;
		session.clientRequestId = parsed.requestId;
		if (!session.proxyServerId) {
			session.proxyServerId = Math.floor(Math.random() * 2 ** 32);
		}

		const reply = this._buildConnectionRequestReply(session);
		this._socket?.send(reply, session.clientPort, session.clientAddress);
	}

	private _handleConnectionRequestReplyConfirm(session: ClientSession, message: Buffer) {
		let parsed: { username: string; serverIdOffset: number };
		try {
			parsed = this._parseConnectionRequestReplyConfirm(message);
		} catch (err: any) {
			this._logger.warn(`Failed to parse connection confirm: ${err.message ?? err}`);
			return;
		}

		session.username = parsed.username;
		session.pendingConfirm = message;
		session.confirmServerIdOffset = parsed.serverIdOffset;

		if (session.route || session.activating) {
			return;
		}

		session.activating = this._activateRoute(session).finally(() => {
			session.activating = undefined;
		});
	}

	private _buildConnectionRequestReply(session: ClientSession) {
		const flags = session.requestFlags ?? 0;
		const version = session.requestVersion ?? { major: 0, minor: 0, sub: 0, build: 0 };
		const requestId = session.clientRequestId ?? 0;
		const serverId = session.proxyServerId ?? 0;

		const writer = new BufferWriter();
		writer.writeUInt8((flags & FLAG_MASK) | TYPE_CONNECTION_REQUEST_REPLY);
		writer.writeSpaceOptimized(version.major);
		writer.writeSpaceOptimized(version.minor);
		writer.writeSpaceOptimized(version.sub);
		writer.writeUInt32LE(version.build);
		writer.writeUInt32LE(requestId);
		writer.writeUInt32LE(serverId);
		writer.writeUInt32LE(MAX_PACKET_SIZE);
		return writer.concat();
	}

	private _parseConnectionRequest(buffer: Buffer) {
		const reader = new BufferReader(buffer);
		const header = reader.readUInt8();
		const type = header & TYPE_MASK;
		if (type !== TYPE_CONNECTION_REQUEST) {
			throw new Error("Unexpected message type");
		}

		const flags = header & FLAG_MASK;
		const messageIdAndFlags = reader.readUInt16LE();
		const version = {
			major: reader.readSpaceOptimized(),
			minor: reader.readSpaceOptimized(),
			sub: reader.readSpaceOptimized(),
			build: reader.readUInt32LE(),
		};
		const requestId = reader.readUInt32LE();
		return { flags, messageIdAndFlags, version, requestId };
	}

	private _parseConnectionRequestReplyConfirm(buffer: Buffer) {
		const reader = new BufferReader(buffer);
		const header = reader.readUInt8();
		const type = header & TYPE_MASK;
		if (type !== TYPE_CONNECTION_REQUEST_REPLY_CONFIRM) {
			throw new Error("Unexpected message type");
		}
		reader.readUInt16LE();
		reader.readUInt32LE(); // client request id
		const serverIdOffset = reader.offset;
		reader.readUInt32LE();
		reader.readUInt32LE(); // instance id
		const nameLength = reader.readContainerSize();
		const nameBuffer = reader.readBytes(nameLength);
		const username = nameBuffer.toString("utf8");
		return { username, serverIdOffset };
	}

	private _handleUpstreamMessage(session: ClientSession, data: Buffer) {
		if (!this._socket || !session.route) {
			return;
		}

		let type: number;
		try {
			type = data.readUInt8(0) & TYPE_MASK;
		} catch {
			return;
		}

		if (type === TYPE_CONNECTION_REQUEST_REPLY && session.serverConnectionId === undefined) {
			try {
				const serverConnectionId = this._parseConnectionRequestReply(data);
				session.serverConnectionId = serverConnectionId;
				this._sendPendingConfirm(session);
			} catch (err: any) {
				this._logger.warn(`Failed to parse upstream reply: ${err.message ?? err}`);
			}
			return;
		}

		this._socket.send(data, session.clientPort, session.clientAddress);
	}

	private _parseConnectionRequestReply(buffer: Buffer) {
		const reader = new BufferReader(buffer);
		const header = reader.readUInt8();
		const type = header & TYPE_MASK;
		if (type !== TYPE_CONNECTION_REQUEST_REPLY) {
			throw new Error("Unexpected message type");
		}
		reader.readSpaceOptimized();
		reader.readSpaceOptimized();
		reader.readSpaceOptimized();
		reader.readUInt32LE();
		reader.readUInt32LE(); // client request id
		return reader.readUInt32LE();
	}

	private async _activateRoute(session: ClientSession) {
		if (!session.username) {
			return;
		}

		const route = this._controller.resolvePlayerRoute(session.username);
		if (!route) {
			this._logger.warn(`No route for ${session.username}, dropping client ${session.clientAddress}:${session.clientPort}`);
			return;
		}

		const instanceReady = await this._ensureInstanceRunning(route.instanceId);
		if (!instanceReady) {
			this._logger.warn(`Instance ${route.instanceId} not ready for ${session.username}`);
			return;
		}

		session.route = route;
		if (!session.upstream) {
			const upstream = dgram.createSocket("udp4");
			session.upstream = upstream;
			upstream.on("message", data => this._handleUpstreamMessage(session, data));
			upstream.on("error", err => {
				this._logger.warn(
					`Upstream error for ${session.clientAddress}:${session.clientPort}: ${err.message}`
				);
				upstream.close();
				this._sessions.delete(clientKey(session.clientAddress, session.clientPort));
			});
		}

		if (session.requestBuffer) {
			session.upstream.send(session.requestBuffer, route.gamePort, route.publicAddress);
		}
	}

	private async _ensureInstanceRunning(instanceId: number) {
		const instance = this._controller.instances.get(instanceId);
		if (!instance || instance.isDeleted) {
			return false;
		}
		if (instance.status === "running") {
			return true;
		}
		if (instance.config.get("instance.assigned_host") === null) {
			return false;
		}

		try {
			await this._controller.sendTo({ instanceId }, new lib.InstanceStartRequest());
		} catch (err: any) {
			this._logger.warn(`Failed to start instance ${instanceId}: ${err.message ?? err}`);
			return false;
		}

		const deadline = Date.now() + SESSION_IDLE_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const current = this._controller.instances.get(instanceId);
			if (!current || current.isDeleted) {
				return false;
			}
			if (current.status === "running") {
				return true;
			}
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		return false;
	}

	private _sendPendingConfirm(session: ClientSession) {
		if (!session.pendingConfirm || session.confirmServerIdOffset === undefined || !session.upstream || !session.route) {
			return;
		}

		if (session.serverConnectionId === undefined) {
			return;
		}

		const payload = Buffer.from(session.pendingConfirm);
		payload.writeUInt32LE(session.serverConnectionId, session.confirmServerIdOffset);
		session.upstream.send(payload, session.route.gamePort, session.route.publicAddress);
		session.pendingConfirm = undefined;
		this._flushPending(session);
	}

	private _queuePending(session: ClientSession, message: Buffer) {
		if (session.pending.length >= MAX_PENDING_PACKETS) {
			session.pending.shift();
		}
		session.pending.push(message);
	}

	private _flushPending(session: ClientSession) {
		if (!session.route || !session.upstream || !session.pending.length) {
			return;
		}
		for (const pending of session.pending) {
			session.upstream.send(pending, session.route.gamePort, session.route.publicAddress);
		}
		session.pending = [];
	}

	private _cleanupSessions() {
		const now = Date.now();
		for (const [key, session] of this._sessions) {
			if (now - session.lastSeenMs > SESSION_IDLE_TIMEOUT_MS) {
				session.upstream?.close();
				this._sessions.delete(key);
			}
		}
	}
}
