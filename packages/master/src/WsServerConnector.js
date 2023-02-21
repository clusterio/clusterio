"use strict";
const events = require("events");

const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");


/**
 * Connector for master server connections
 *
 * @extends module:lib/link.WebSocketBaseConnector
 * @alias module:master/src/WsServerConnector
 */
class WsServerConnector extends libLink.WebSocketBaseConnector {
	constructor(sessionId, sessionTimeout, heartbeatInterval) {
		super(sessionTimeout);

		this._socket = null;
		this._sessionId = sessionId;
		this._heartbeatInterval = heartbeatInterval;
		this._timeoutId = null;

		// The following states are used in the server connector
		// closed: Connection is closed
		// connected: Connection is online
		// resuming: Waiting for client to resume.
	}

	_reset() {
		clearTimeout(this._timeoutId);
		this._timeoutId = null;
		super._reset();
	}

	/**
	 * Send ready over the socket
	 *
	 * Sends the ready message over the socket to initiate the session.
	 *
	 * @param {Object} socket - WebSocket connection to client.
	 * @param {string} sessionToken -
	 *     the session token to send to the client.
	 * @param {Object=} additionalData -
	 *     extra properties to send along the ready message.
	 */
	ready(socket, sessionToken, additionalData) {
		this._socket = socket;
		this._socket.send(JSON.stringify({
			seq: null,
			type: "ready",
			data: {
				session_token: sessionToken,
				session_timeout: this._sessionTimeout,
				heartbeat_interval: this._heartbeatInterval,
				...additionalData,
			},
		}));

		this._state = "connected";
		this._attachSocketHandlers();
		this.emit("connect");
	}

	/**
	 * Continue connection with the given socket
	 *
	 * Terminates the current socket and contiunes the session over the
	 * socket given from the message sequence given.
	 *
	 * @param {module:net.Socket} socket - New socket to continue on.
	 * @param {number} lastSeq - The last message the client received.
	 */
	continue(socket, lastSeq) {

		// It's possible the previous connection hasn't closed yet due to a
		// stale connection.  Terminate it if so.
		if (this._state === "connected") {
			this._socket.terminate();
			this._socket.once("close", () => this.continue(socket, lastSeq));
			return;
		}

		this._socket = socket;

		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}

		this._socket.send(JSON.stringify({
			seq: null,
			type: "continue",
			data: {
				last_seq: this._lastReceivedSeq,
				session_timeout: this._sessionTimeout,
				heartbeat_interval: this._heartbeatInterval,
			},
		}));

		this._state = "connected";
		this._attachSocketHandlers();
		this._dropSendBufferSeq(lastSeq);
		for (let message of this._sendBuffer) {
			this._socket.send(JSON.stringify(message));
		}
		this.emit("resume");
	}

	_timedOut() {
		logger.verbose("Connector | Connection timed out");
		this._reset();
		this.emit("close");
	}

	_attachSocketHandlers() {
		this.startHeartbeat();

		this._socket.on("close", (code, reason) => {
			logger.verbose(`Connector | Close (code: ${code}, reason: ${reason})`);
			this.stopHeartbeat();

			if (this._closing) {
				this._reset();
				this.emit("close");

			} else {
				this._state = "resuming";
				this.emit("drop");
				this._timeoutId = setTimeout(() => { this._timedOut(); }, this._sessionTimeout * 1000);
			}

		});

		this._socket.on("error", err => {
			// It's assumed that close is always called by ws
			logger.verbose("Connector | Error:", err);
		});

		this._socket.on("open", () => {
			logger.verbose("Connector | Open");
		});
		this._socket.on("ping", data => {
			logger.verbose(`Connector | Ping (data: ${data}`);
		});
		this._socket.on("pong", data => {
			logger.verbose(`Connector | Pong (data: ${data}`);
		});

		// Handle messages
		this._socket.on("message", data => {
			let message = JSON.parse(data);
			if (["connected", "closing"].includes(this._state)) {
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
		});
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

		if (this._state === "resuming") {
			this._reset();
			this.emit("close");
			return;
		}

		this._closing = true;
		this._socket.close(code, reason);
		await events.once(this, "close");
	}

	/**
	 * Forcefully close the connection immediately
	 *
	 * This should only be used if there's a security implication from
	 * letting the connection carry on with a normal close proceedure.
	 */
	terminate() {
		this.setClosing();

		if (this._socket) {
			this._socket.terminate();
		}
	}

	/**
	 * Notify the connection is expected to close
	 *
	 * Sets the internal flag to signal not to wait for the client to
	 * reconnect and resume the connection if the client closes it.  This
	 * will close the connection if it's currently waiting for the client to
	 * resume it.
	 */
	setClosing() {
		if (this._state === "resuming") {
			this._reset();
			this.emit("close");
			return;
		}

		this._closing = true;
	}
}

module.exports = WsServerConnector;
