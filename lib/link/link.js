"use strict";
const events = require("events");
const io = require("socket.io-client");

const schema = require("lib/schema");
const errors = require("lib/errors");
const messages = require("lib/link/messages");

// Some definitions for the terminology used here:
// link: Either side of a master - client connection
// connection: the master server side of a link
// client: the side that is not the master server of a link
// message: the complete object sent using the 'message' event
// data: the data property of a message, essentially the payload.
// type: the type property of a message, identifies what to expect in data.

/**
 * Common interface for server and client connections
 */
class Link {
	constructor(source, target, socket) {
		this.source = source;
		this.target = target;
		this.socket = socket;

		this._seq = 1;
		this._waiters = new Map();
		this._handlers = new Map();
		this._validators = new Map();
	}

	/**
	 * Process a received message on the link
	 *
	 * Validates and invokes the handler and/or waiters for a message that has
	 * been received.  An unhandled message is considered to be an error.
	 *
	 * @throws {InvalidMessage}
	 *     if validation failed, is missing, the message is invalid, or no
	 *     handlers/waiters were invoked to handle the message.
	 */
	processMessage(message) {
		if (!schema.message(message)) {
			throw new errors.InvalidMessage("Malformed message");
		}

		let validator = this._validators.get(message.type);
		if (!validator) {
			throw new errors.InvalidMessage(`No validator for ${message.type}`);
		}

		if (!validator(message)) {
			// TODO better logging of errors encountered validating
			console.error(validator.errors);
			throw new errors.InvalidMessage(`Validation failed for ${message.type}`);
		}

		let hadHandlers = this._processHandler(message);
		let hadWaiters = this._processWaiters(message);

		if (!hadWaiters && !hadHandlers) {
			// XXX console.error(`Unhandled message: ${JSON.stringify(message, null, 4)}`);
			throw new errors.InvalidMessage(`Unhandled message ${message.type}`);
		}
	}

	/**
	 * Invoke the handler for this message if it exists
	 *
	 * @returns {Boolean} true if a handler was invoked.
	 */
	_processHandler(message) {
		let handler = this._handlers.get(message.type);
		if (handler) {
			handler(message);
			return true;
		} else {
			return false;
		}
	}

	/**
	 * Invokes the waiters for this message if any
	 *
	 * @returns {Boolean} true if a waiter was triggered.
	 */
	_processWaiters(message) {
		let { seq, type, data } = message;
		let waiters = this._waiters.get(type);
		if (!waiters || !waiters.length) {
			return false;
		}

		let matched = [];
		waitersLoop: for (let index = 0; index < waiters.length; index++) {
			let waiter = waiters[index];
			for (let [key, value] of Object.entries(waiter.data)) {
				if (data[key] !== value) {
					continue waitersLoop;
				}
			}

			waiter.resolve(message);
			matched.push(index);
		}

		matched.reverse();
		for (let index of matched) {
			waiters.splice(index, 1);
		}

		return matched.length > 0;
	}

	/**
	 * Set handler for a message type
	 *
	 * Set function called upon receiving a message of the given type.
	 *
	 * @param {string} type - Type of message to listen to
	 * @param {function} handler -
	 *     Callack to invoke on messages of the given type.
	 * @param {function} validator -
	 *     Function validating the message have the correct format.
	 */
	setHandler(type, handler, validator) {
		if (this._handlers.has(type)) {
			throw new Error(`${type} already has a handler`);
		}

		if (!validator) {
			throw new Error("validator is required");
		}

		this.setValidator(type, validator);
		this._handlers.set(type, handler);
	}

	/**
	 * Set validator for a message type
	 *
	 * Set function called upon receiving a message of the given type in
	 * order to validate the message.  The function should return true if
	 * the message is valid and false otherwise.
	 *
	 * @param {string} type - Type of message to validate
	 * @param {function} validator - Validation function.
	 */
	setValidator(type, validator) {
		if (this._validators.has(type)) {
			throw new Error(`${type} already has a validator`);
		}

		this._validators.set(type, validator);
	}

	/**
	 * Send a message over the link
	 *
	 * @returns the sequence number of the message sent
	 */
	send(type, data) {
		this.socket.send({ seq: this._seq, type, data });
		return this._seq++;
	}

	/**
	 * Wait for a message matching given type and data
	 *
	 * Waits for a message over the link that matches the type given as well
	 * as any properties specified in data.  For example specifying { foo:
	 * 21 } as the data will cause it to wait until a message with the right
	 * type and a foo property value of 21 in the data payload.
	 */
	async waitFor(type, data) {
		if (!this._validators.has(type)) {
			throw new Error(`no validator for ${type}`);
		}

		return new Promise((resolve, reject) => {
			if (!this._waiters.has(type)) {
				this._waiters.set(type, [{ data, resolve }]);
			} else {
				this._waiters.get(type).push({ data, resolve });
			}
		});
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close message and disconnects from the socket.
	 */
	close(reason) {
		this.send('close', { reason });
		this.disconnect();
	}


	/**
	 * Disconnect from the socket
	 *
	 * Abstract function that subclases override to implement disconnection
	 * from the socket.
	 */
	disconnect() {
		throw new Error("Abstract function");
	}
}

class Connection extends Link {
	constructor(target, socket) {
		super('master', target, socket);

		this._seq = 3; // XXX this is private to Link
		this.socket.on('message', payload => {
			try {
				this.processMessage(payload);
			} catch (err) {
				if (err instanceof errors.InvalidMessage) {
					this.close(`Invalid message: ${err.message}`);
				} else {
					throw err;
				}
			}
		});
		this.socket.on('disconnect', this.disconnect.bind(this));

		this.setHandler('close', payload => {
			let address = this.socket.handshake.address
			console.log(`SOCKET | received close from control ${address}: ${payload.data.reason}`);
			this.socket.disconnect(true);
		}, schema.close);

		socket.send({ seq: 2, type: 'ready', data: {} });
	}

	disconnect() {
		this.socket.disconnect(true);
	}
}


class Client extends Link {
	constructor(source, url, token) {
		super(source, 'master', null);

		this._url = url;
		this._token = token;

		this._state = "new";
		this._events = new events.EventEmitter();

		this.setHandler('close', message => {
			console.log(`SOCKET | received close from server: ${message.data.reason}`);
			this.socket.close();
			return; // XXX what now?
		}, schema.close);
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

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
		this.socket = io(url.href, {
			path: urlPath,
			reconnectionAttempts: 2,

			// For now we do not verify TLS certificates since the default setup is
			// to create a self-signed certificate.
			rejectUnauthorized: false,
		});

		_attachSocketHandlers();

		// Wait for the connection to be ready
		await events.once(this._events, 'ready');
	}

	_attachSocketHandlers() {
		this.socket.on("error", err => {
			console.error("SOCKET | Error:", err);
			this.socket.close();
		});

		/*this.socket.on("connect_error", err => {
			console.log("SOCKET | Connect error:", err);
		});*/
		this.socket.on("connect_timeout", () => {
			console.log("SOCKET | Connect timeout");
		});
		this.socket.on("reconnect", attempt => {
			console.log(`SOCKET | Reconnect no. ${attempt} succeeded`);
		});
		this.socket.on("reconnect_attempt", () => {
			console.log("SOCKET | Attempting reconnect");
		});
		this.socket.on("reconnecting", attempt => {
			console.log(`SOCKET | Attempting reconnect no. ${attempt}`);
		});
		/*this.socket.on("reconnect_error", err => {
			console.log("SOCKET | Reconnect error:", err);
		});*/
		this.socket.on("reconnect_failed", () => {
			console.log("SOCKET | Reconnecting failed");
		});
		/*this.socket.on("ping", () => {
			console.log("SOCKET | Ping");
		});
		this.socket.on("pong", (ms) => {
			// XXX Latency might be useful
			console.log(`SOCKET | Pong latency ${ms}ms`);
		});*/
		this.socket.on("connect", () => {
			console.log("SOCKET | connected");
		});

		// Handle messages
		this.socket.on("message", message => {
			if (this._state === "handshake") {
				this._processHandshake(message);
			} else if (this._state === "ready") {
				try {
					this.processMessage(message);
				} catch (err) {
					if (err instanceof errors.InvalidMessage) {
						this.close(`Invalid message: ${err.message}`);
					} else {
						throw err;
					}
				}
			} else {
				throw new Error(`Received message in unexpected state ${this._state}`);
			}
		})
	}

	disconnect(reason) {
		this.socket.close();
		// XXX what now?
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
			this._events.emit('ready');

		} else if (type === 'close') {
			console.log(`SOCKET | received close from server: ${data.reason}`);
			this._events.emit('error', new Error(`server closed during handshake: ${data.reason}`));
			this.socket.close();
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
	Link,
	Connection,
	Client,
}
