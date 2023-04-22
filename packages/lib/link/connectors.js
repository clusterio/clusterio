// Connection adapters for Links
"use strict";
const assert = require("assert").strict;
const events = require("events");
const WebSocket = require("isomorphic-ws");

const libData = require("../data");
const libErrors = require("../errors");
const { logger } = require("../logging");
const ExponentialBackoff = require("../ExponentialBackoff");


/**
 * Base connector for links
 *
 * @extends events.EventEmitter
 * @memberof module:lib/link
 */
class BaseConnector extends events.EventEmitter {
	constructor(src, dst) {
		super();
		this._seq = 1;
		this.src = src;
		this.dst = dst;
	}

	_reset() {
		this._seq = 1;
	}

	_invalidate() {
		this._seq = 1;
	}

	sendRequest(request, requestId, dst) {
		let seq = this._seq;
		this._seq += 1;
		let src = new libData.Address(this.src.type, this.src.id, requestId);
		let name = request.constructor.name;
		let hasData = Boolean(request.constructor.jsonSchema);
		const message = new libData.MessageRequest(seq, src, dst, name, hasData ? request : undefined);
		this.send(message);
		return seq;
	}

	sendResponse(response, dst) {
		let seq = this._seq;
		this._seq += 1;
		const message = new libData.MessageResponse(seq, this.src, dst, response);
		this.send(message);
		return seq;
	}

	sendResponseError(error, dst) {
		let seq = this._seq;
		this._seq += 1;
		const message = new libData.MessageResponseError(seq, this.src, dst, error);
		this.send(message);
		return seq;
	}

	sendEvent(event, dst) {
		let seq = this._seq;
		this._seq += 1;
		let name = event.constructor.name;
		let hasData = Boolean(event.constructor.jsonSchema);
		const message = new libData.MessageEvent(seq, this.src, dst, name, hasData ? event : undefined);
		this.send(message);
		return seq;
	}
}

/**
 * Base connector for links
 *
 * @extends module:lib/link.BaseConnector
 * @memberof module:lib/link
 */
class WebSocketBaseConnector extends BaseConnector {
	constructor(src, dst) {
		super(src, dst);

		// One of closed, connecting (client only), connected and resuming.
		this._state = "closed";
		this._closing = false;
		this._socket = null;
		this._lastHeartbeat = null;
		this._heartbeatId = null;
		this._heartbeatInterval = null;
		this._lastReceivedSeq = undefined;
		this._sendBuffer = [];
	}

	_reset() {
		this._state = "closed";
		this._closing = false;
		assert(this._socket === null);
		this._lastHeartbeat = null;
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
		this._lastHeartbeat = null;
		assert(this._heartbeatId === null);
		this._heartbeatInterval = null;
		this._lastReceivedSeq = undefined;
		this._sendBuffer.length = 0;
		super._invalidate();
	}

	_check(...expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	_dropSendBufferSeq(seq) {
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

	_parseMessage(text) {
		let json;
		try {
			json = JSON.parse(text);
		} catch (err) {
			this.close(4000, "Malformed JSON");
			return undefined;
		}
		if (!libData.Message.validate(json)) {
			logger.error(`Received malformed message: ${text}`);
			// logger.error(JSON.stringify(libData.Message.validate.errors, null, 4));
			this.close(4000, "Malformed message");
			return undefined;
		}
		return libData.Message.fromJSON(json);
	}

	_processMessage(message) {
		if (message.type === "heartbeat") {
			this._processHeartbeat(message);

		} else if (message.type === "disconnect") {
			if (message.data === "ready") {
				this.emit("disconnectReady");

			} else if (message.data === "prepare") {
				this.setClosing();
				this.emit("disconnectPrepare");
			}

		} else {
			if (message.seq !== undefined) {
				this._lastReceivedSeq = message.seq;
			}

			this.emit("message", message);
		}
	}

	_doHeartbeat() {
		this._check("connected");
		if (Date.now() - this._lastHeartbeat > 2000 * this._heartbeatInterval) {
			logger.verbose("Connector | closing after heartbeat timed out");
			// eslint-disable-next-line node/no-process-env
			if (process.env.APP_ENV === "browser") {
				this._socket.close(4008, "Heartbeat timeout");
			} else {
				this._socket.terminate();
			}

		} else {
			this._sendInternal(new libData.MessageHeartbeat(this._lastReceivedSeq));
		}
	}

	_processHeartbeat(message) {
		this._lastHeartbeat = Date.now();
		this._dropSendBufferSeq(message.seq);
	}

	/**
	 * Start sending heartbeats
	 */
	startHeartbeat() {
		if (this._heartbeatId) {
			throw new Error("heartbeat is already running");
		}
		this._lastHeartbeat = Date.now();
		this._heartbeatId = setInterval(() => {
			this._doHeartbeat();
		}, this._heartbeatInterval * 1000);
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
	 * @param {module:lib/data.Message} message - Message to send.
	 */
	send(message) {
		if (!["connected", "resuming"].includes(this._state)) {
			throw new libErrors.SessionLost("No session");
		}

		this._sendBuffer.push(message);
		if (this._state === "connected") {
			this._sendInternal(message);
		}
	}

	_sendInternal(message) {
		this._socket.send(JSON.stringify(message));
	}

	/**
	 * Set connection state to closing
	 *
	 * Signal the connection is about to close and that once the close
	 * frame is received it should be considered finished.
	 */
	setClosing() {
		throw new Error("Abstract function");
	}

	/**
	 * Gracefully disconnect
	 *
	 * Sets closing flag an initiates the disconnect sequence.
	 */
	async disconnect() {
		if (this._state !== "connected") {
			await this.close(1000, "Disconnect");
			return;
		}

		this.setClosing();
		this.send(new libData.MessageDisconnect("prepare"));

		let timeout;
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

		await this.close(1000, "Disconnect");
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
}

/**
 * Connector for controller clients
 *
 * @extends module:lib/link.WebSocketBaseConnector
 * @memberof module:lib/link
 */
class WebSocketClientConnector extends WebSocketBaseConnector {
	constructor(url, maxReconnectDelay, tlsCa = null) {
		super(undefined, new libData.Address(libData.Address.controller, 0));

		this._url = url;
		this._backoff = new ExponentialBackoff({ max: maxReconnectDelay });
		this._tlsCa = tlsCa;

		// The following states are used in the client connector
		// closed: Not connected
		// connecting: Attempting to connect to server.
		// resuming: Attempting to resume an existing connection to the server.
		// connected: Connection is online
		this._reconnectId = null;
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._startedResuming = null;
	}

	_reset() {
		clearTimeout(this._reconnectId);
		this._reconnectId = null;
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._startedResuming = null;
		super._reset();
		this.src = undefined;
	}

	_invalidate() {
		assert(this._reconnectId === null);
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._startedResuming = null;
		super._invalidate();
		this.src = undefined;
	}

	/**
	 * Send a handshake message over the socket
	 *
	 * Used in the register function in order to send the handshake messages
	 * over the WebSocket.
	 *
	 * @param {module:lib/data.Message} message - Message to send.
	 */
	sendHandshake(message) {
		this._check("connecting", "resuming");
		this._sendInternal(message);
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close frame and disconnects the connector.
	 *
	 * @param {number} code - WebSocket close code.
	 * @param {string} reason - WebSocket close reason.
	 */
	async close(code, reason) {
		if (this._state === "closed") {
			return;
		}

		this._closing = true;
		if (this._state === "connected" || this._socket) {
			this._socket.close(code, reason);
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
			this._socket.close(1000, "Connector closing");

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

		// Open WebSocket to controller
		logger.verbose(`Connector | connecting to ${url}`);

		// eslint-disable-next-line node/no-process-env
		if (process.env.APP_ENV === "browser") {
			this._socket = new WebSocket(url);

		} else {
			let options = {};
			if (this._tlsCa) { options.ca = this._tlsCa; }
			this._socket = new WebSocket(url, options);
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

		if (this._reconnectId !== null) {
			logger.error("Unexpected double call to reconnect");
		}

		let delay = this._backoff.delay();
		if (
			this._state === "resuming"
			&& this._startedResuming + this._sessionTimeout * 1000 < Date.now() + delay
		) {
			logger.error("Connector | Session timed out trying to resume");
			this._reset();
			if (this._disconnecting) {
				this._reset();
				this.emit("close");
			} else {
				this._state = "connecting";
				this.emit("invalidate");
			}
		}
		logger.verbose(
			`Connector | waiting ${(Math.round(delay / 10) / 100)} seconds for reconnect`
		);
		this._reconnectId = setTimeout(() => {
			this._reconnectId = null;
			this._doConnect();
		}, delay);
		this._reconnectTime = Date.now() + delay;
	}

	_attachSocketHandlers() {
		this._socket.onclose = event => {
			const previousState = this._state;

			// Authentication failed
			if (event.code === 4003) {
				this.emit("error", new libErrors.AuthenticationFailed(event.reason));
				this._closing = true;
			}

			this._socket = null;
			if (this._state === "connected") {
				this.stopHeartbeat();
				if (this._closing) {
					this._reset();
					this.emit("close");

				} else {
					this._state = "resuming";
					this._startedResuming = Date.now();
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
			if (previousState === "connected" && event.code !== 1000) {
				logger.info(message);
			} else {
				logger.verbose(message);
			}
		};

		this._socket.onerror = event => {
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

		this._socket.onopen = () => {
			logger.verbose("Connector | Open");
		};

		// Handle messages
		this._socket.onmessage = event => {
			let message = this._parseMessage(event.data);
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

	_processHandshake(message) {

		let { type, data } = message;
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
			this._startedResuming = null;
			this.emit("resume");

		} else if (type === "invalidate") {
			logger.warn("Connector | session invalidated by controller");
			if (this._disconnecting) {
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
	register() {
		throw Error("Abstract function");
	}
}

/**
 * Connector for in-memory local links
 *
 * @extends events.EventEmitter
 * @memberof module:lib/link
 */
class VirtualConnector extends BaseConnector {
	constructor(src, dst) {
		super(src, dst);

		this.other = this;
	}

	/**
	 * Create a pair of virtual connector hooked into each other
	 *
	 * Creates two virtual connectors that are liked to each othes such that
	 * a message sent on one is received by the other.
	 *
	 * @param {module:lib/data.Address} src - Source for obverse connector
	 * @param {module:lib/data.Address} dst - destination for obverse connector
	 * @returns {Array} two virtuarl connectors.
	 */
	static makePair(src, dst) {
		let obverse = new this(src, dst);
		let reverse = new this(dst, src);
		obverse.other = reverse;
		reverse.other = obverse;
		return [obverse, reverse];
	}

	/**
	 * Send a message to the other end of the connector
	 *
	 * @param {module:lib/data.Message} message - Message type to send.
	 */
	send(message) {
		this.other.emit("message", message);
	}
}

module.exports = {
	BaseConnector,
	WebSocketBaseConnector,
	WebSocketClientConnector,
	VirtualConnector,
};
