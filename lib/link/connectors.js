"use strict";
const events = require("events");
const WebSocket = require("ws");

const schema = require("lib/schema");


/**
 * Connector for master server clients
 */
class WebSocketClientConnector extends events.EventEmitter {
	constructor(url) {
		super();

		this._url = url;

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
		this._socket.send(JSON.stringify({ seq: this._seq, type, data }));
		return this._seq++;
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close message and disconnects the connector.
	 */
	close(reason) {
		this.send('close', { reason });
		this._socket.close();
	}

	/**
	 * Connect to the master server
	 */
	async connect() {
		this._check(["new"]);
		this._state = "handshake";

		let url = new URL(this._url);
		url.pathname += "api/socket";

		// Open WebSocket to master
		console.log(`SOCKET | connecting to ${url}`)

		this._socket = new WebSocket(url, {
			// For now we do not verify TLS certificates since the default setup is
			// to create a self-signed certificate.
			rejectUnauthorized: false,
		});

		this._attachSocketHandlers();

		// Wait for the connection to be ready
		await events.once(this, 'ready');
	}

	_attachSocketHandlers() {
		this._socket.on("close", (code, reason) => {
			console.log(`SOCKET | Close (code: ${code}, reason: ${reason})`);
		});
		this._socket.on("error", err => {
			console.error("SOCKET | Error:", err);
			this._socket.close();
		});
		this._socket.on("unexpected-response", (req, res) => {
			let data = "";
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				console.error(`SOCKET | Unexpeced Response ${res.statusCode}`);
				console.error(data);
			});
		});

		this._socket.on("open", () => {
			console.log("SOCKET | Open");
		});
		this._socket.on("ping", data => {
			console.log(`SOCKET | Ping (data: ${data}`);
		});
		this._socket.on("pong", data => {
			console.log(`SOCKET | Pong (data: ${data}`);
		});

		// Handle messages
		this._socket.on("message", data => {
			let message = JSON.parse(data);
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
		this._socket.terminate();
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
			this._socket.terminate();
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
	 * @returns the sequence number of the message sent
	 */
	send(type, data) {
		this.other.emit('message', { seq: this._seq, type, data });
		return this._seq++;
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close message to the other end of the connector with the
	 * given reason.  Doesn't actually disconnect as virtual connectors
	 * doen't have a concept of disconnecting.
	 */
	close(reason) {
		this.send('close', { reason });
	}

	/**
	 * Does nothing
	 *
	 * Virtual connectors do not have a concept of disconnecting.
	 */
	disconnect() { }
}

module.exports = {
	WebSocketClientConnector,
	VirtualConnector,
};
