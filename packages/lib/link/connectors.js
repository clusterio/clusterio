// Connection adapters for Links
"use strict";
const events = require("events");
const WebSocket = require("isomorphic-ws");

const libSchema = require("@clusterio/lib/schema");
const libErrors = require("@clusterio/lib/errors");


/**
 * Base connector for links
 *
 * @extends events.EventEmitter
 * @memberof module:lib/link
 */
class WebSocketBaseConnector extends events.EventEmitter {
	constructor() {
		super();

		this._socket = null;
		this._seq = 1;
		this._lastHeartbeat = null;
		this._heartbeatId = null;
		this._heartbeatInterval = null;
		this._lastReceivedSeq = null;
		this._sendBuffer = [];
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
		this._check(["connected", "closing"]);
		if (Date.now() - this._lastHeartbeat > 2000 * this._heartbeatInterval) {
			console.log("SOCKET | closing after heartbeat timed out");
			this._socket.close(1008, "Heartbeat timeout");
			clearInterval(this._heartbeatId);
			this._heartbeatId = null;

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
			console.log("SOCKET | closing after received invalid heartbeat:", message);
			this._socket.close(1002, "Invalid heartbeat");
			console.log(libSchema.heartbeat.errors);
			return;
		}

		this._lastHeartbeat = Date.now();
		this._dropSendBufferSeq(message.data.seq);
	}

	/**
	 * Start sending heartbeats
	 */
	startHeartbeat() {
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
	 * @param {string} type - Message type to send.
	 * @param {Object} data - Data to send with message.
	 * @returns {number} the sequence number of the message sent
	 */
	send(type, data) {
		if (!["handshake", "connected", "closing"].includes(this._state)) {
			throw new libErrors.SessionLost("No session");
		}
		let seq = this._seq;
		this._seq += 1;
		let message = { seq, type, data };
		this._sendBuffer.push(message);
		if (["connected", "closing"].includes(this._state)) {
			this._socket.send(JSON.stringify(message));
		}
		return seq;
	}

	/**
	 * Set connection state to closing
	 *
	 * Signal the connection is about tho close and that once the close
	 * frame is received it should be considered finished.
	 */
	setClosing() {
		this._state = "closing";
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
		return ["closing", "closed"].includes(this._state);
	}
}

/**
 * Connector for master server clients
 *
 * @extends module:lib/link.WebSocketBaseConnector
 * @memberof module:lib/link
 */
class WebSocketClientConnector extends WebSocketBaseConnector {
	constructor(url, reconnectDelay) {
		super();

		this._url = url;

		// The following states are used in the client connector
		// new: Not connected
		// handshake: Attempting to (re)connect to server.
		// connected: Connection is online
		// closing: Connection is in the process of being closed.
		this._state = "new";
		this._reconnectId = null;
		this._sessionToken = null;
		this._connected = false;
		this._reconnectDelay = reconnectDelay;
		this._timeout = 15 * 60;
		this._startedReconnect = null;
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	setTimeout(timeout) {
		this._timeout = timeout;

		if (this._reconnectId && this.timeout < this._reconnectDelay / 2) {
			clearTimeout(this._reconnectId);
			this.reconnect();
		}
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
		this._check(["handshake"]);
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
		if (this._state === "new") {
			return;
		}

		if (this._reconnectId) {
			clearTimeout(this._reconnectId);
			this._reconnectId = null;
		}

		this.stopHeartbeat();
		this._state = "closing";
		this._socket.close(code, reason);
		await events.once(this, "close");
	}

	/**
	 * Connect to the master server
	 */
	async connect() {
		this._check(["new"]);
		this._state = "handshake";

		this._doConnect();

		// Wait for the connection to be ready
		await events.once(this, "connect");
	}

	async _doConnect() {
		let url = new URL(this._url);
		url.pathname += "api/socket";

		// Open WebSocket to master
		console.log(`SOCKET | connecting to ${url}`);

		// eslint-disable-next-line no-process-env
		if (process.env.APP_ENV === "browser") {
			this._socket = new WebSocket(url);

		} else {
			this._socket = new WebSocket(url, {
				// For now we do not verify TLS certificates since the default setup is
				// to create a self-signed certificate.
				rejectUnauthorized: false,
			});
		}

		this._attachSocketHandlers();
	}

	/**
	 * Attempt re-establishing the connecting again
	 */
	reconnect() {
		if (this._reconnectId !== null) {
			return;
		}

		if (this._startedReconnect === null) {
			this._startedReconnect = Date.now();
		}

		if (this._startedReconnect + this._timeout * 1000 < Date.now()) {
			console.log("SOCKET | Timed out trying to reconnect");
			this._heartbeatInterval = null;
			this._lastReceivedSeq = null;
			this._sessionToken = null;
			this._sendBuffer.length = 0;
			this._connected = false;
			this.emit("close");
			return;
		}

		let delay = Math.random() * this._reconnectDelay;
		console.log(`SOCKET | waiting ${delay.toLocaleString("en", { maximumFractionDigits: 2 })} seconds for reconnect`);
		this._reconnectId = setTimeout(() => {
			this._reconnectId = null;
			this._doConnect();
		}, delay * 1000);
	}

	_attachSocketHandlers() {
		this._socket.onclose = event => {
			console.log(`SOCKET | Close (code: ${event.code}, reason: ${event.reason})`);
			// Authentication failed
			if (event.code === 4003) {
				this.emit("error", new libErrors.AuthenticationFailed(event.reason));
				this._state = "closing";
			}

			if (this._state === "closing") {
				this._lastReceivedSeq = null;
				this._sessionToken = null;
				this._sendBuffer.length = 0;
				this._state = "new";
				this._connected = false;
				this.emit("close");

			} else {
				this._state = "handshake";
				this.reconnect();
				if (this._connected) {
					this._connected = false;
					this.emit("drop");
				}
			}

			this.stopHeartbeat();
		};

		this._socket.onerror = event => {
			// It's assumed that close is always called by ws
			console.error("SOCKET | Error:", event);
		};

		this._socket.onopen = () => {
			console.log("SOCKET | Open");
		};

		// Handle messages
		this._socket.onmessage = event => {
			let message = JSON.parse(event.data);
			if (this._state === "handshake") {
				this._processHandshake(message);

			} else if (["connected", "closing"].includes(this._state)) {
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
			console.log("SOCKET | closing after received invalid handshake:", message);
			this._socket.close(1002, "Invalid handshake");
			return;
		}

		let { seq, type, data } = message;
		if (type === "hello") {
			console.log(`SOCKET | received hello from master version ${data.version}`);
			this.emit("hello", data);
			if (this._sessionToken) {
				console.log("SOCKET | Attempting resume");
				this.sendHandshake("resume", {
					session_token: this._sessionToken,
					last_seq: this._lastReceivedSeq,
				});
			} else {
				this.register();
			}

		} else if (type === "ready") {
			console.log("SOCKET | received ready from master");
			this._state = "connected";
			this._sessionToken = data.session_token;
			this._heartbeatInterval = data.heartbeat_interval;
			this.startHeartbeat();
			for (let bufferedMessage of this._sendBuffer) {
				this._socket.send(JSON.stringify(bufferedMessage));
			}
			this._startedReconnect = null;
			this._connected = true;
			this.emit("connect");

		} else if (type === "continue") {
			console.log("SOCKET | resuming existing session");
			this._state = "connected";
			this._heartbeatInterval = data.heartbeat_interval;
			this.startHeartbeat();
			this._dropSendBufferSeq(data.last_seq);
			for (let bufferedMessage of this._sendBuffer) {
				this._socket.send(JSON.stringify(bufferedMessage));
			}
			this._startedReconnect = null;
			this._connected = true;
			this.emit("connect");

		} else if (type === "invalidate") {
			this._heartbeatInterval = null;
			this._lastReceivedSeq = null;
			this._sessionToken = null;
			this._sendBuffer.length = 0;
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
