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
	constructor(socket, sessionId, heartbeatInterval) {
		super();

		this._socket = socket;
		this._sessionId = sessionId;
		this._heartbeatInterval = heartbeatInterval;

		// The following states are used in the server connector
		// handshake: Waiting for client to (re)connect.
		// connected: Connection is online
		// closing: Connection is in the process of being closed.
		// closed: Connection has been closed
		this._state = "handshake";
		this._timeout = 15 * 60;
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	/**
	 * Send ready over the socket
	 *
	 * Sends the ready message over the socket to initiate the session.
	 *
	 * @param {string} sessionToken -
	 *     the session token to send to the client.
	 * @param {Object=} additionalData -
	 *     extra properties to send along the ready message.
	 */
	ready(sessionToken, additionalData) {
		this._socket.send(JSON.stringify({
			seq: null,
			type: "ready",
			data: {
				session_token: sessionToken,
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
		// stale connection.  If this is the case the connector will have to
		// wait for the previous socket to close down before it can continue
		// from a new socket, or there will be overlapping events from both.
		if (["connected", "closing"].includes(this._state)) {
			this._socket.close(4003, "Session Hijacked");

			// Correctly waiting for the connector to close and then
			// handling all the edge cases like multiple continues happening
			// in parallel or connections going stale is far too difficult.
			// Kill the connection here and let the client reconnect later
			// when the connector is not held up by an active connection.
			socket.close(1013, "Session Busy");
			socket.terminate();
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

	setTimeout(timeout) {
		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
		}

		this._timeoutId = setTimeout(() => { this._timedOut(); }, timeout * 1000);
		this._timeout = timeout;
	}

	_timedOut() {
		logger.verbose("SOCKET | Connection timed out");
		this._timeoutId = null;
		this._lastReceivedSeq = null;
		this._sendBuffer.length = 0;
		this._state = "closed";
		this.emit("close");
		this.emit("invalidate");
	}

	_attachSocketHandlers() {
		this.startHeartbeat();

		this._socket.on("close", (code, reason) => {
			logger.verbose(`SOCKET | Close (code: ${code}, reason: ${reason})`);
			if (this._state === "closing") {
				this._lastReceivedSeq = null;
				this._sendBuffer.length = 0;
				this._state = "closed";
				this.emit("close");

				if (this._timeoutId) {
					clearTimeout(this._timeoutId);
					this._timeoutId = null;
				}

			} else {
				this._state = "handshake";
				this.emit("drop");
				this._timeoutId = setTimeout(() => { this._timedOut(); }, this._timeout * 1000);
			}

			this.stopHeartbeat();
		});

		this._socket.on("error", err => {
			// It's assumed that close is always called by ws
			logger.verbose("SOCKET | Error:", err);
		});

		this._socket.on("open", () => {
			logger.verbose("SOCKET | Open");
		});
		this._socket.on("ping", data => {
			logger.verbose(`SOCKET | Ping (data: ${data}`);
		});
		this._socket.on("pong", data => {
			logger.verbose(`SOCKET | Pong (data: ${data}`);
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

		this.stopHeartbeat();
		this._state = "closing";
		this._socket.close(code, reason);
		await events.once(this, "close");
	}
}

module.exports = WsServerConnector;
