// Connection adapters for Links
"use strict";
const events = require("events");
const WebSocket = require("isomorphic-ws");

const libSchema = require("../schema");
const libErrors = require("../errors");
const { logger } = require("../logging");
const ExponentialBackoff = require("../ExponentialBackoff");


/**
 * Base connector for links
 *
 * @extends events.EventEmitter
 * @memberof module:lib/link
 */
class WebSocketBaseConnector extends events.EventEmitter {
	constructor(sessionTimeout) {
		super();

		this._sessionTimeout = sessionTimeout;

		// One of closed, connecting (client only), connected and resuming.
		this._state = "closed";
		this._closing = false;
		this._socket = null;
		this._seq = 1;
		this._lastHeartbeat = null;
		this._heartbeatId = null;
		this._heartbeatInterval = null;
		this._lastReceivedSeq = null;
		this._sendBuffer = [];
	}

	_reset() {
		this._state = "closed";
		this._closing = false;
		this._socket = null;
		this._seq = 1;
		this._lastHeartbeat = null;
		this._heartbeatId = null;
		this._heartbeatInterval = null;
		this._lastReceivedSeq = null;
		this._sendBuffer.length = 0;
	}

	_check(...expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	_dropSendBufferSeq(seq) {
		if (seq === null) {
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
			this._socket.send(JSON.stringify({
				seq: null,
				type: "heartbeat",
				data: { seq: this._lastReceivedSeq },
			}));
		}
	}

	_processHeartbeat(message) {
		if (!libSchema.heartbeat(message)) {
			logger.warn("Connector | closing after received invalid heartbeat");
			this._socket.close(1002, "Invalid heartbeat");
			return;
		}

		this._lastHeartbeat = Date.now();
		this._dropSendBufferSeq(message.data.seq);
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
			this._lastHeartbeat = null;
		}
	}

	/**
	 * Send a message over the socket
	 *
	 * @param {string} type - Message type to send.
	 * @param {Object} data - Data to send with message.
	 * @returns {number} the sequence number of the message sent
	 */
	send(type, data) {
		if (!["connected", "resuming"].includes(this._state)) {
			throw new libErrors.SessionLost("No session");
		}
		let seq = this._seq;
		this._seq += 1;
		let message = { seq, type, data };
		this._sendBuffer.push(message);
		if (this._state === "connected") {
			this._socket.send(JSON.stringify(message));
		}
		return seq;
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
	 * True if the connection is established and active
	 */
	get connected() {
		return this._state === "connected";
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
 * Connector for master server clients
 *
 * @extends module:lib/link.WebSocketBaseConnector
 * @memberof module:lib/link
 */
class WebSocketClientConnector extends WebSocketBaseConnector {
	constructor(url, maxReconnectDelay, tlsCa = null) {
		super(null);

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
		this._startedResuming = null;
	}

	_reset() {
		clearTimeout(this._reconnectId);
		this._reconnectId = null;
		this._lastReceivedSeq = null;
		this._sessionToken = null;
		this._sessionTimeout = null;
		this._sendBuffer.length = 0;
		this._startedResuming = null;
		super._reset();
	}

	/**
	 * Send a handshake message over the socket
	 *
	 * Used in the register function in order to send the register handshake
	 * message over the WebSocket.
	 *
	 * @param {string} type - Message type to send.
	 * @param {Object} data - Data to send with message.
	 */
	sendHandshake(type, data) {
		this._check("connecting", "resuming");
		this._socket.send(JSON.stringify({ seq: null, type, data }));
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
	 * Connect to the master server
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

		// Open WebSocket to master
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
			this._state = "connecting";
			this.emit("invalidate");
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
			let message = JSON.parse(event.data);
			if (["connecting", "resuming"].includes(this._state)) {
				this._processHandshake(message);

			} else if (this._state === "connected") {
				if (message.seq !== null) {
					this._lastReceivedSeq = message.seq;
				}

				if (message.type === "heartbeat") {
					this._processHeartbeat(message);

				} else {
					this.emit("message", message);
				}

			} else {
				throw new Error(`Received message in unexpected state ${this._state}`);
			}
		};
	}

	_processHandshake(message) {
		if (!libSchema.serverHandshake(message)) {
			logger.warn("Connector | closing after received invalid handshake");
			this._socket.close(1002, "Invalid handshake");
			return;
		}

		let { type, data } = message;
		if (type === "hello") {
			logger.verbose(`Connector | received hello from master version ${data.version}`);
			this.emit("hello", data);
			if (this._sessionToken) {
				logger.verbose("Connector | Attempting resume");
				this.sendHandshake("resume", {
					session_token: this._sessionToken,
					last_seq: this._lastReceivedSeq,
				});
			} else {
				this.register();
			}

		} else if (type === "ready") {
			logger.verbose("Connector | received ready from master");
			this._state = "connected";
			this._sessionToken = data.session_token;
			this._sessionTimeout = data.session_timeout;
			this._heartbeatInterval = data.heartbeat_interval;
			this.startHeartbeat();
			for (let bufferedMessage of this._sendBuffer) {
				this._socket.send(JSON.stringify(bufferedMessage));
			}
			this.emit("connect", data);

		} else if (type === "continue") {
			logger.info("Connector | resuming existing session");
			this._state = "connected";
			this._heartbeatInterval = data.heartbeat_interval;
			this._sessionTimeout = data.session_timeout;
			this.startHeartbeat();
			this._dropSendBufferSeq(data.last_seq);
			for (let bufferedMessage of this._sendBuffer) {
				this._socket.send(JSON.stringify(bufferedMessage));
			}
			this._startedResuming = null;
			this.emit("resume");

		} else if (type === "invalidate") {
			logger.warn("Connector | session invalidated by master");
			this._state = "connecting";
			this._seq = 1;
			this._lastReceivedSeq = null;
			this._sessionToken = null;
			this._sessionTimeout = null;
			this._sendBuffer.length = 0;
			this._startedResuming = null;
			this.emit("invalidate");
			this.register();
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
class VirtualConnector extends events.EventEmitter {
	constructor() {
		super();

		this.other = this;
		this._seq = 1;
	}

	/**
	 * Create a pair of virtual connector hooked into each other
	 *
	 * Creates two virtual connectors that are liked to each othes such that
	 * a message sent on one is received by the other.
	 *
	 * @returns {Array} two virtuarl connectors.
	 */
	static makePair() {
		let first = new this();
		let second = new this();
		first.other = second;
		second.other = first;
		return [first, second];
	}

	/**
	 * Send a message to the other end of the connector
	 *
	 * @param {string} type - Message type to send.
	 * @param {Object} data - Data to send with message.
	 * @returns {number} the sequence number of the message sent
	 */
	send(type, data) {
		let seq = this._seq;
		this._seq += 1;
		this.other.emit("message", { seq, type, data });
		return seq;
	}
}

module.exports = {
	WebSocketBaseConnector,
	WebSocketClientConnector,
	VirtualConnector,
};
