// Connection adapters for Links
import { strict as assert } from "assert";
import events from "events";

import WebSocket from "./WebSocket";
import * as libData from "../data";
import * as libErrors from "../errors";
import { logger } from "../logging";
import ExponentialBackoff from "../ExponentialBackoff";
import type { Request, Event } from "./link";

/**
 * Numbered codes describing why a connection was closed
 * See: https://github.com/Luka967/websocket-close-codes
 * See: https://www.iana.org/assignments/websocket/websocket.xhtml#close-code-number
 * See: https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4
 */
export enum ConnectionClosed {
	// Codes between 1000 and 1015 are pre-assigned by IANA
	// A browser client can only (on demand) send 1000 from this range
	NormalClosure = 1000, // Purpose fulfilled
	GoingAway = 1001, // Server quit or browser navigation
	ProtocolError = 1002, // Protocol not followed
	PolicyViolation = 1008, // Generic code for any endpoint policy
	InternalError = 1011, // Endpoint failed to fulfil request
	TryAgainLater = 1013, // Temporary server condition blocking requests

	// Codes after 3000 are available for frameworks
	// However they should be registered to IANA
	Unauthorized = 3000,
	Forbidden = 3003,
	Timeout = 3008,

	// Codes after 4000 are available for applications
	MalformedMessage = 4000,
	RecoveryMode = 4001,
};

type BaseConnectorEvents = {
	"message": [ message: libData.Message ],
};

/**
 * Base connector for links
 *
 * @extends events.EventEmitter
 */
export abstract class BaseConnector<
	E extends Record<string, any[]> = never, // Should be "extends EventMap"
> extends events.EventEmitter<E | BaseConnectorEvents> {
	protected _seq = 1;

	constructor(
		public src: libData.Address,
		public dst: libData.Address,
	) {
		super();
	}

	_reset() {
		this._seq = 1;
	}

	_invalidate() {
		this._seq = 1;
	}

	protected abstract send(message: libData.MessageRoutable): void;
	abstract get valid(): boolean;

	forward(message: libData.MessageRoutable) {
		const seq = this._seq;
		this._seq += 1;
		// The message type currently can't be inferred like a tagged union
		// TODO fix typing of message so it can be deduced from .type
		if (message.type === "request") {
			const request = message as libData.MessageRequest;
			this.send(new libData.MessageRequest(seq, request.src, request.dst, request.name, request.data));
		} else if (message.type === "response") {
			const response = message as libData.MessageResponse;
			this.send(new libData.MessageResponse(seq, response.src, response.dst, response.data));
		} else if (message.type === "responseError") {
			const error = message as libData.MessageResponseError;
			this.send(new libData.MessageResponseError(seq, error.src, error.dst, error.data));
		} else if (message.type === "event") {
			const event = message as libData.MessageEvent;
			this.send(new libData.MessageEvent(seq, event.src, event.dst, event.name, event.data));
		} else {
			throw new Error(`Cannot forward message type ${(message as any).type}`);
		}
		return seq;
	}

	sendRequest<Req, Res>(
		request: Request<Req, Res>,
		requestId: number,
		dst: libData.Address
	) {
		let seq = this._seq;
		this._seq += 1;
		let src = new libData.Address(this.src.type, this.src.id, requestId);
		let Request = request.constructor;
		let name = Request.plugin ? `${Request.plugin}:${Request.name}` : Request.name;
		let hasData = Boolean(Request.jsonSchema);
		const message = new libData.MessageRequest(seq, src, dst, name, hasData ? request : undefined);
		this.send(message);
		return seq;
	}

	sendResponse(response: unknown, dst: libData.Address, src = this.src) {
		let seq = this._seq;
		this._seq += 1;
		const message = new libData.MessageResponse(seq, src, dst, response);
		this.send(message);
		return seq;
	}

	sendResponseError(error: libData.ResponseError, dst: libData.Address, src = this.src) {
		let seq = this._seq;
		this._seq += 1;
		const message = new libData.MessageResponseError(seq, src, dst, error);
		this.send(message);
		return seq;
	}

	sendEvent<T>(event: Event<T>, dst: libData.Address) {
		let seq = this._seq;
		this._seq += 1;
		let Event = event.constructor;
		let name = Event.plugin ? `${Event.plugin}:${Event.name}` : Event.name;
		let hasData = Boolean(Event.jsonSchema);
		const message = new libData.MessageEvent(seq, this.src, dst, name, hasData ? event : undefined);
		this.send(message);
		return seq;
	}
}

type ConnectorState = "closed" | "connecting" | "connected" | "resuming";

type WebSocketBaseConnectorEvents = {
	"disconnectReady": [],
	"disconnectPrepare": [],
	"close": [],
};

export type WebSocketClusterio = WebSocket.WebSocket & {
	clusterio_ignore_dump?: boolean;
};

/**
 * Base connector for links
 *
 * @extends module:lib.BaseConnector
 */
export abstract class WebSocketBaseConnector<
	E extends Record<string, any[]> = never, // Should be "extends EventMap"
> extends BaseConnector<E | WebSocketBaseConnectorEvents> {
	// One of closed, connecting (client only), connected and resuming.
	_state: ConnectorState = "closed";
	_closing = false;
	_socket: WebSocketClusterio | null = null;
	_lastHeartbeatMs: number | null = null;
	_heartbeatId: ReturnType<typeof setInterval> | null = null;
	_heartbeatInterval: number | null = null;
	_lastReceivedSeq = undefined;
	_sendBuffer: (libData.MessageRoutable)[] = [];

	_reset() {
		this._state = "closed";
		this._closing = false;
		assert(this._socket === null);
		this._lastHeartbeatMs = null;
		assert(this._heartbeatId === null);
		this._heartbeatInterval = null;
		this._lastReceivedSeq = undefined;
		this._sendBuffer.length = 0;
		super._reset();
	}

	_invalidate() {
		this._state = "connecting";
		assert(this._closing === false);
		assert(this._socket);
		this._lastHeartbeatMs = null;
		assert(this._heartbeatId === null);
		this._heartbeatInterval = null;
		this._lastReceivedSeq = undefined;
		this._sendBuffer.length = 0;
		super._invalidate();
	}

	_check(...expectedStates: ConnectorState[]) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	_dropSendBufferSeq(seq?: number) {
		if (seq === undefined) {
			return;
		}

		let dropCount = 0;
		for (let index = 0; index < this._sendBuffer.length; index++) {
			if (this._sendBuffer[index].seq <= seq) {
				dropCount += 1;
			} else {
				break;
			}
		}
		this._sendBuffer.splice(0, dropCount);
	}

	_parseMessage(text: string) {
		let json: object;
		try {
			json = JSON.parse(text);
		} catch (err) {
			this.close(ConnectionClosed.MalformedMessage, "Malformed JSON");
			return undefined;
		}
		if (!libData.Message.validate(json)) {
			logger.error(`Received malformed message: ${text}`);
			// logger.error(JSON.stringify(libData.Message.validate.errors, null, "\t"));
			this.close(ConnectionClosed.MalformedMessage, "Malformed message");
			return undefined;
		}
		return libData.Message.fromJSON(json);
	}

	_processMessage(message: libData.Message) {
		// TODO check if this can be inferred from Message type
		if (message.type === "heartbeat") {
			this._processHeartbeat(message as libData.MessageHeartbeat);

		} else if (message.type === "disconnect") {
			const data = (message as libData.MessageDisconnect).data;
			if (data === "ready") {
				this.emit("disconnectReady");

			} else if (data === "prepare") {
				this.setClosing();
				this.emit("disconnectPrepare");
			}

		} else {
			if ((message as any).seq !== undefined) {
				this._lastReceivedSeq = (message as any).seq;
			}

			this.emit("message", message);
		}
	}

	_doHeartbeat() {
		this._check("connected");
		if (Date.now() - this._lastHeartbeatMs! > 2000 * this._heartbeatInterval!) {
			logger.verbose("Connector | closing after heartbeat timed out");
			// eslint-disable-next-line node/no-process-env
			if (process.env.APP_ENV === "browser") {
				this._socket!.close(ConnectionClosed.Timeout, "Heartbeat timeout");
			} else {
				this._socket!.terminate();
			}

		} else {
			this._sendInternal(new libData.MessageHeartbeat(this._lastReceivedSeq));
		}
	}

	_processHeartbeat(message: libData.MessageHeartbeat) {
		this._lastHeartbeatMs = Date.now();
		this._dropSendBufferSeq(message.seq);
	}

	/**
	 * Start sending heartbeats
	 */
	startHeartbeat() {
		if (this._heartbeatId) {
			throw new Error("heartbeat is already running");
		}
		this._lastHeartbeatMs = Date.now();
		this._heartbeatId = setInterval(() => {
			this._doHeartbeat();
		}, this._heartbeatInterval! * 1000);
	}

	/**
	 * Stop sending heartbeats
	 */
	stopHeartbeat() {
		if (this._heartbeatId) {
			clearInterval(this._heartbeatId);
			this._heartbeatId = null;
		}
	}

	/**
	 * Send a message over the socket
	 *
	 * This is a low level method that should only be used for implementing
	 * links. See sendTo for sending requests and events.
	 *
	 * @param message - Message to send.
	 */
	protected send(message: libData.MessageRoutable) {
		if (!["connected", "resuming"].includes(this._state)) {
			throw new libErrors.SessionLost("No session");
		}

		this._sendBuffer.push(message);
		if (this._state === "connected") {
			this._sendInternal(message);
		}
	}

	_sendInternal(message: libData.Message) {
		this._socket!.send(JSON.stringify(message));
	}

	/**
	 * Set connection state to closing
	 *
	 * Signal the connection is about to close and that once the close
	 * frame is received it should be considered finished.
	 */
	abstract setClosing(): void;
	abstract close(code: number, reason: string): Promise<void>;

	/**
	 * Gracefully disconnect
	 *
	 * Sets closing flag an initiates the disconnect sequence.
	 * @param [code=1000] WebSocket close code.
	 * @param [reason="Disconnect"] WebSocket close reason.
	 */
	async disconnect(code: number = ConnectionClosed.NormalClosure, reason: string = "Disconnect") {
		if (this._state !== "connected") {
			await this.close(code, reason);
			return;
		}

		this.setClosing();
		this._sendInternal(new libData.MessageDisconnect("prepare"));

		let timeout: ReturnType<typeof setTimeout> | undefined;
		let waitTimeout = new Promise(resolve => { timeout = setTimeout(resolve, 10000); }); // Make Configurable?
		try {
			await Promise.race([
				waitTimeout,
				events.once(this, "close"),
				events.once(this, "disconnectReady"),
			]);
		} finally {
			clearTimeout(timeout);
		}

		await this.close(code, reason);
	}

	/**
	 * Notify other end that the link is ready to disconnect
	 */
	sendDisconnectReady() {
		this._sendInternal(new libData.MessageDisconnect("ready"));
	}

	/**
	 * True if the connection is established and active
	 */
	get connected() {
		return !this._closing && this._state === "connected";
	}

	/**
	 * True if the connection is closing down or closed
	 */
	get closing() {
		return this._closing || this._state === "closed";
	}

	/**
	 * True if the connector currently has a valid session that is either
	 * connected or in the process of resuming.
	 */
	get hasSession() {
		return ["connected", "resuming"].includes(this._state);
	}

	/**
	 * True if the connector is valid and can accept new messages,
	 * only needs to be checked on fringe cases during setup and tear down.
	 */
	get valid() {
		return this.hasSession;
	}
}

type WebSocketClientConnectorEvents = {
	"hello": [ data: any ],
	"connect": [ data: any ],
	"resume": [],
	"drop": [],
	"invalidate": [],
	"error": [ err: libErrors.WebSocketError ],
};

/**
 * Connector for controller clients
 *
 * @extends module:lib.WebSocketBaseConnector
 */
export abstract class WebSocketClientConnector extends WebSocketBaseConnector<WebSocketClientConnectorEvents> {
	_reconnectId?: ReturnType<typeof setTimeout>;
	_sessionToken: string | null = null;
	_sessionTimeout: number | null = null;
	_startedResumingMs: number | null = null;
	_backoff: ExponentialBackoff;

	constructor(
		protected _url: string,
		maxReconnectDelay: number,
		protected _tlsCa: string | undefined,
	) {
		super(undefined as any, new libData.Address(libData.Address.controller, 0));
		this._backoff = new ExponentialBackoff({ max: maxReconnectDelay });

		// The following states are used in the client connector
		// closed: Not connected
		// connecting: Attempting to connect to server.
		// resuming: Attempting to resume an existing connection to the server.
		// connected: Connection is online
	}

	_reset() {
		clearTimeout(this._reconnectId);
		this._reconnectId = undefined;
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._startedResumingMs = null;
		super._reset();
		this.src = undefined as any;
	}

	_invalidate() {
		assert(this._reconnectId === undefined);
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._startedResumingMs = null;
		super._invalidate();
		this.src = undefined as any;
	}

	/**
	 * Send a handshake message over the socket
	 *
	 * Used in the register function in order to send the handshake messages
	 * over the WebSocket.
	 *
	 * @param message - Message to send.
	 */
	sendHandshake(message: libData.Message) {
		this._check("connecting", "resuming");
		this._sendInternal(message);
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close frame and disconnects the connector.
	 *
	 * @param code - WebSocket close code.
	 * @param reason - WebSocket close reason.
	 */
	async close(code: number, reason: string) {
		if (this._state === "closed") {
			return;
		}

		this._closing = true;
		if (this._state === "connected" || this._socket) {
			this._socket!.close(code, reason);
			await events.once(this, "close");

		} else {
			this._reset();
			this.emit("close");
		}
	}

	/**
	 * Notify the connection is expected to close
	 *
	 * Sets the internal flag to signal not to attempt to resume the
	 * connection if the server closes it.  This will close the connection
	 * if it's currently attempting to connect or resume.
	 */
	setClosing() {
		if (this._state === "closed") {
			return;
		}

		this._closing = true;
		if (this._state === "connected") {
			return;
		}

		if (this._socket) {
			this._socket!.close(ConnectionClosed.NormalClosure, "Connector closing");

		} else {
			this._reset();
			this.emit("close");
		}
	}

	/**
	 * Connect to the controller
	 */
	async connect() {
		this._check("closed");
		this._state = "connecting";

		this._doConnect();

		// Wait for the connection to be ready
		await events.once(this, "connect");
	}

	_doConnect() {
		let url = new URL(this._url);
		url.pathname += "api/socket";
		url.protocol = url.protocol.replace("http", "ws");

		// Open WebSocket to controller
		logger.verbose(`Connector | connecting to ${url}`);

		// eslint-disable-next-line node/no-process-env
		if (process.env.APP_ENV === "browser") {
			this._socket = new WebSocket(url) as WebSocketClusterio;

		} else {
			let options: { ca?: string } = {};
			if (this._tlsCa) { options.ca = this._tlsCa; }
			this._socket = new WebSocket(url, options) as WebSocketClusterio;
		}

		this._attachSocketHandlers();
	}

	/**
	 * Attempt re-establishing the connecting again
	 */
	reconnect() {
		if (this._socket) {
			throw new Error("Cannot reconnect while socket is open");
		}

		if (this._reconnectId !== undefined) {
			logger.error("Unexpected double call to reconnect");
		}

		let delayMs = this._backoff.delay();
		if (
			this._state === "resuming"
			&& this._startedResumingMs! + this._sessionTimeout! * 1000 < Date.now() + delayMs
		) {
			logger.error("Connector | Session timed out trying to resume");
			this._reset();
			if (this._closing) {
				this._reset();
				this.emit("close");
			} else {
				this._state = "connecting";
				this.emit("invalidate");
			}
		}
		logger.verbose(
			`Connector | waiting ${(Math.round(delayMs / 10) / 100)} seconds for reconnect`
		);
		this._reconnectId = setTimeout(() => {
			this._reconnectId = undefined;
			this._doConnect();
		}, delayMs);
	}

	_attachSocketHandlers() {
		this._socket!.onclose = (event) => {
			const previousState = this._state;

			switch (event.code) {
				case ConnectionClosed.Unauthorized:
					// Authentication failed
					this.emit("error", new libErrors.AuthenticationFailed(event.reason));
					this._closing = true;
					break;
				case ConnectionClosed.ProtocolError:
					// Connection was closed because invalid data was sent
					this.emit("error", new libErrors.ProtocolError(event.reason));
					this._closing = true;
					break;
				case ConnectionClosed.PolicyViolation:
					// Connection was closed to prevent the server entering an invalid state
					this.emit("error", new libErrors.PolicyViolation(event.reason));
					this._closing = true;
					break;
				default:
			}

			this._socket = null;
			if (this._state === "connected") {
				this.stopHeartbeat();
				if (this._closing) {
					this._reset();
					this.emit("close");

				} else {
					this._state = "resuming";
					this._startedResumingMs = Date.now();
					this.reconnect();
					this.emit("drop");
				}

			} else {
				// eslint-disable-next-line no-lonely-if
				if (this._closing) {
					this._reset();
					this.emit("close");

				} else {
					this.reconnect();
				}
			}

			// Log must be sent after state change is complete
			let message = `Connector | Close (code: ${event.code}, reason: ${event.reason})`;
			if (previousState === "connected" && event.code !== ConnectionClosed.NormalClosure) {
				logger.info(message);
			} else {
				logger.verbose(message);
			}
		};

		this._socket!.onerror = (event) => {
			// It's assumed that close is always called by ws
			let code = !event.error ? "" : `, code: ${event.error.code}`;
			let message = `Connector | Socket error: ${event.message || "unknown error"}${code}`;
			if (this._state === "connected") {
				logger.error(message);
			} else {
				// Don't log as error if not actually connected, prevents
				// log spam during reconnecting attempts.
				logger.verbose(message);
			}
			if (event.error) {
				// Abort connection if certificate validation failed
				if ([
					"CERT_HAS_EXPIRED",
					"DEPTH_ZERO_SELF_SIGNED_CERT",
					"ERR_TLS_CERT_ALTNAME_INVALID",
				].includes(event.error.code)) {
					this.emit("error", new libErrors.AuthenticationFailed(event.error.message));
					this._closing = true;
				}
			}
		};

		this._socket!.onopen = () => {
			logger.verbose("Connector | Open");
		};

		// Handle messages
		this._socket!.onmessage = (event) => {
			let message = this._parseMessage(event.data as string);
			if (!message) {
				return;
			}
			if (["connecting", "resuming"].includes(this._state)) {
				this._processHandshake(message);

			} else if (this._state === "connected") {
				this._processMessage(message);

			} else {
				throw new Error(`Received message in unexpected state ${this._state}`);
			}
		};
	}

	_processHandshake(message: libData.Message) {
		// TODO infer data from Message type.
		let { type, data } = message as libData.Message & { data: any };
		if (type === "hello") {
			logger.verbose(`Connector | received hello from controller version ${data.version}`);
			this.emit("hello", data);
			if (this._sessionToken) {
				logger.verbose("Connector | Attempting resume");
				this.sendHandshake(new libData.MessageResume(
					new libData.ResumeData(this._sessionToken, this._lastReceivedSeq)
				));
			} else {
				this.register();
			}

		} else if (type === "ready") {
			logger.verbose("Connector | received ready from controller");
			this._state = "connected";
			this.src = data.src;
			this._sessionToken = data.sessionToken;
			this._sessionTimeout = data.sessionTimeout;
			this._heartbeatInterval = data.heartbeatInterval;
			this.startHeartbeat();
			for (let bufferedMessage of this._sendBuffer) {
				this._sendInternal(bufferedMessage);
			}
			this.emit("connect", data);

		} else if (type === "continue") {
			logger.info("Connector | resuming existing session");
			this._state = "connected";
			this._heartbeatInterval = data.heartbeatInterval;
			this._sessionTimeout = data.sessionTimeout;
			this.startHeartbeat();
			this._dropSendBufferSeq(data.lastSeq);
			for (let bufferedMessage of this._sendBuffer) {
				this._sendInternal(bufferedMessage);
			}
			this._startedResumingMs = null;
			this.emit("resume");

		} else if (type === "invalidate") {
			logger.warn("Connector | session invalidated by controller");
			if (this._closing) {
				this._reset();
				this.emit("close");
			} else {
				this._invalidate();
				this.emit("invalidate");
				this.register();
			}
		}
	}

	/**
	 * Register the link with the server
	 *
	 * This function is expected to be overriden by sub-classes and send the
	 * register message over the socket when invoked.
	 */
	abstract register(): void;
}

/**
 * Connector for in-memory local links
 *
 * @extends events.EventEmitter
 */
export class VirtualConnector extends BaseConnector {
	other: VirtualConnector;

	constructor(src: libData.Address, dst: libData.Address) {
		super(src, dst);

		this.other = this;
	}

	/**
	 * Create a pair of virtual connector hooked into each other
	 *
	 * Creates two virtual connectors that are liked to each othes such that
	 * a message sent on one is received by the other.
	 *
	 * @param src - Source for obverse connector
	 * @param dst - destination for obverse connector
	 * @returns two virtuarl connectors.
	 */
	static makePair(
		src: libData.Address,
		dst: libData.Address,
	): [VirtualConnector, VirtualConnector] {
		let obverse = new this(src, dst);
		let reverse = new this(dst, src);
		obverse.other = reverse;
		reverse.other = obverse;
		return [obverse, reverse];
	}

	/**
	 * Send a message to the other end of the connector
	 *
	 * @param message - Message type to send.
	 */
	send(message: libData.Message) {
		this.other.emit("message", message);
	}

	/**
	 * True if the connector is valid and can accept new messages,
	 * only needs to be checked on fringe cases during setup and tear down.
	 *
	 * For a virtual connector this is always true.
	 */
	get valid() {
		return true;
	}
}
