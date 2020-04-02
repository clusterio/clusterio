"use strict";

const schema = require("lib/schema");
const errors = require("lib/errors");
const messages = require("lib/link/messages");

// Some definitions for the terminology used here:
// link: Either side of a master - client connection
// connector: Adapter between a link and a socket connection
// connection: the master server side of a link
// client: the side that is not the master server of a link
// message: the complete object sent using the 'message' event
// data: the data property of a message, essentially the payload.
// type: the type property of a message, identifies what to expect in data.

/**
 * Common interface for server and client connections
 */
class Link {
	constructor(source, target, connector) {
		this.source = source;
		this.target = target;
		this.connector = connector;

		this._waiters = new Map();
		this._handlers = new Map();
		this._validators = new Map();

		// Process messages received by the connector
		connector.on('message', payload => {
			try {
				this.processMessage(payload);
			} catch (err) {
				if (err instanceof errors.InvalidMessage) {
					console.error(`Invalid message on ${this.source}-${this.target} link: ${err.message}`)
					if (err.errors) {
						console.error(err.errors);
					}
				} else {
					this.connector.emit('error', err);
				}
			}
		});

		connector.on("invalidate", () => {
			for (let waiterType of this._waiters.values()) {
				for (let waiter of waiterType) {
					waiter.reject(new Error("Session lost"));
				}
			}

			this._waiters.clear();
		});
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
			throw new errors.InvalidMessage("Malformed", schema.message.errors);
		}

		let validator = this._validators.get(message.type);
		if (!validator) {
			throw new errors.InvalidMessage(`No validator for ${message.type} on ${this.source}-${this.target}`);
		}

		if (!validator(message)) {
			throw new errors.InvalidMessage(`Validation failed for ${message.type}`, validator.errors);
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
	 * Wait for a message matching given type and data
	 *
	 * Waits for a message over the link that matches the type given as well
	 * as any properties specified in data.  For example specifying { foo:
	 * 21 } as the data will cause it to wait until a message with the right
	 * type and a foo property value of 21 in the data payload.
	 */
	async waitFor(type, data) {
		if (!this._validators.has(type)) {
			throw new Error(`No validator for ${type} on ${this.source}-${this.target}`);
		}

		let waiter = { data };
		waiter.promise = new Promise((resolve, reject) => {
			waiter.resolve = resolve;
			waiter.reject = reject;
			if (!this._waiters.has(type)) {
				this._waiters.set(type, [waiter]);
			} else {
				this._waiters.get(type).push(waiter);
			}
		});
		return waiter.promise;
	}

	/**
	 * Handle ping requests
	 */
	async pingRequestHandler() { }

	/**
	 * Prepare connection for close
	 *
	 * Waits for all pending requests on the connection to resolve.
	 * Sub-classes should implement this handler with code that prevents
	 * additional requests to be sent out before calling the super class
	 * method.
	 */
	async shutdownConnectionRequestHandler() {
		let promises = [];
		for (let waiterType of this._waiters.values()) {
			for (let waiter of waiterType) {
				promises.push(waiter.promise.then(() => {}, () => {}));
			}
		}

		await Promise.all(promises);
	}
}


module.exports = {
	Link,
}
