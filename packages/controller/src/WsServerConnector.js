"use strict";
const events = require("events");

const libData = require("@clusterio/lib/data");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");


/**
 * Connector for controller connections
 *
 * @extends module:lib/link.WebSocketBaseConnector
 * @alias module:controller/src/WsServerConnector
 */
class WsServerConnector extends libLink.WebSocketBaseConnector {
	constructor(dst, sessionId, sessionTimeout, heartbeatInterval) {
		super(new libData.Address(libData.Address.controller, 0), dst);

		this._sessionTimeout = sessionTimeout;
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
	 * @param {module:lib/data.Address} src - Source address for this link.
	 * @param {string} sessionToken -
	 *     the session token to send to the client.
	 * @param {module:lib/data.AccountDetails=} account -
	 *     account data to provide to control connection
	 */
	ready(socket, src, sessionToken, account) {
		this._socket = socket;
		this._sendInternal(new libData.MessageReady(
			new libData.ReadyData(
				src,
				sessionToken,
				this._sessionTimeout,
				this._heartbeatInterval,
				account,
			),
		));

		this._state = "connected";
		this._attachSocketHandlers();
		this.emit("connect", { src: this.src });
	}

	/**
	 * Continue connection with the given socket
	 *
	 * Terminates the current socket and contiunes the session over the
	 * socket given from the message sequence given.
	 *
	 * @param {module:net.Socket} socket - New socket to continue on.
	 * @param {number=} lastSeq - The last message the client received.
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

		this._sendInternal(new libData.MessageContinue(
			new libData.ContinueData(this._sessionTimeout, this._heartbeatInterval, this._lastReceivedSeq)
		));

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
			this._socket = null;

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
			let message = this._parseMessage(data);
			if (!message) {
				return;
			}
			if (this._state === "connected") {
				this._processMessage(message);

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
