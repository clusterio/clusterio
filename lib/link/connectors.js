"use strict";
const events = require("events");
const io = require("socket.io-client");

const schema = require("lib/schema");


/**
 * Connector for master server clients
 */
class SocketIOClientConnector extends events.EventEmitter {
	constructor(url, token) {
		super();

		this._url = url;
		this._token = token;

		this._seq = 1;
		this._state = "new";
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	/**
	 * Send a message over the socket
	 *
	 * @returns the sequence number of the message sent
	 */
	send(type, data) {
		this._socket.send({ seq: this._seq, type, data });
		return this._seq++;
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close message and disconnects the connector.
	 */
	close(reason) {
		this.send('close', { reason });
		this.disconnect();
	}

	/**
	 * Connect to the master server
	 */
	async connect() {
		this._check(["new"]);
		this._state = "handshake";

		// Open socket.io connection to master
		console.log(`SOCKET | connecting to ${this._url}`)
		let url = new URL(this._url);
		url.searchParams.append('token', this._token);

		// I really have to question the choice of having the path connected
		// to be passed as separate parameter instead of the namespace.
		let urlPath = url.pathname + "socket.io";
		url.pathname = "";
		this._socket = io(url.href, {
			path: urlPath,
			reconnectionAttempts: 2,

			// For now we do not verify TLS certificates since the default setup is
			// to create a self-signed certificate.
			rejectUnauthorized: false,
		});

		this._attachSocketHandlers();

		// Wait for the connection to be ready
		await events.once(this, 'ready');
	}

	_attachSocketHandlers() {
		this._socket.on("error", err => {
			console.error("SOCKET | Error:", err);
			this._socket.close();
		});

		/*this._socket.on("connect_error", err => {
			console.log("SOCKET | Connect error:", err);
		});*/
		this._socket.on("connect_timeout", () => {
			console.log("SOCKET | Connect timeout");
		});
		this._socket.on("reconnect", attempt => {
			console.log(`SOCKET | Reconnect no. ${attempt} succeeded`);
		});
		this._socket.on("reconnect_attempt", () => {
			console.log("SOCKET | Attempting reconnect");
		});
		this._socket.on("reconnecting", attempt => {
			console.log(`SOCKET | Attempting reconnect no. ${attempt}`);
		});
		/*this._socket.on("reconnect_error", err => {
			console.log("SOCKET | Reconnect error:", err);
		});*/
		this._socket.on("reconnect_failed", () => {
			console.log("SOCKET | Reconnecting failed");
		});
		/*this._socket.on("ping", () => {
			console.log("SOCKET | Ping");
		});
		this._socket.on("pong", (ms) => {
			// XXX Latency might be useful
			console.log(`SOCKET | Pong latency ${ms}ms`);
		});*/
		this._socket.on("connect", () => {
			console.log("SOCKET | connected");
		});

		// Handle messages
		this._socket.on("message", message => {
			if (this._state === "handshake") {
				this._processHandshake(message);
			} else if (this._state === "ready") {
				this.emit("message", message);
			} else {
				throw new Error(`Received message in unexpected state ${this._state}`);
			}
		});
	}

	/**
	 * Immediatly close the connection
	 */
	disconnect() {
		this._socket.close();
	}

	_processHandshake(message) {
		if (!schema.serverHandshake(message)) {
			console.log("SOCKET | closing after received invalid handshake:", message);
			this.close("Invalid handshake");
			return;
		}

		let { seq, type, data } = message;
		if (type == 'hello') {
			console.log(`SOCKET | received hello from master version ${data.version}`);
			this.register();

		} else if (type === 'ready') {
			console.log("SOCKET | received ready from master");
			this._state = "ready";
			this.emit('ready');

		} else if (type === 'close') {
			console.log(`SOCKET | received close from server: ${data.reason}`);
			this.emit('error', new Error(`server closed during handshake: ${data.reason}`));
			this._socket.close();
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

module.exports = {
	SocketIOClientConnector,
};
