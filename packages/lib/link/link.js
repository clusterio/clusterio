// Implementation of Link class
"use strict";

const libData = require("../data");
const libErrors = require("../errors");
const { logger } = require("../logging");
const libSchema = require("../schema");

// Some definitions for the terminology used here:
// link: Either side of a controller - client connection
// connector: Adapter between a link and a socket connection
// connection: the controller side of a link
// client: the side that is not the controller of a link
// message: the complete object sent using the 'message' event
// data: the data property of a message, essentially the payload.
// type: the type property of a message, identifies what to expect in data.

/**
 * Common interface for server and client connections
 *
 * @memberof module:lib/link
 */
class Link {
	constructor(connector) {
		this.connector = connector;
		this.router = undefined;
		this.validateSent = true;

		this._registeredRequests = new Map();
		this._fallbackedRequests = new Map();
		this._registeredEvents = new Map();
		this._snoopedEvents = new Map();
		this._eventHandlers = new Map();
		this._pendingRequests = new Map();
		this._nextRequestId = 1;

		this.register(libData.PingRequest, () => {});

		// Process messages received by the connector
		connector.on("message", payload => {
			try {
				this._processMessage(payload);
			} catch (err) {
				if (err instanceof libErrors.InvalidMessage) {
					logger.error(err.message);
					if (err.errors) {
						logger.error(JSON.stringify(err.errors, null, 4));
					}

				} else {
					// Unexpected error, bubble back to connector
					this.connector.emit("error", err);
				}
			}
		});

		connector.on("disconnectPrepare", () => {
			this.prepareDisconnect().catch(
				err => {
					logger.error(`Unexpected error preparing disconnect:\n${err.stack}`);
				}
			).finally(
				() => {
					this.connector.send(new libData.MessageDisconnect("ready"));
				},
			);
		});

		connector.on("invalidate", () => {
			for (let pending of this._pendingRequests.values()) {
				pending.reject(new libErrors.SessionLost("Session Lost"));
			}

			this._pendingRequests.clear();
		});

		connector.on("close", () => {
			for (let pending of this._pendingRequests.values()) {
				pending.reject(new libErrors.SessionLost("Session Closed"));
			}

			this._pendingRequests.clear();
		});
	}

	/**
	 * Process a received message on the link
	 *
	 * Validates and invokes the handler and/or waiters for a message that has
	 * been received.  An unhandled message is considered to be an error.
	 *
	 * @param {module:lib/data.Message} message - Message to process.
	 * @throws {module:lib/errors.InvalidMessage} if the message is invalid or not handled.
	 */
	_processMessage(message) {
		if (!["request", "response", "responseError", "event"].includes(message.type)) {
			throw new libErrors.InvalidMessage(`Unhandled message type ${message.type}`);
		}

		if (message.type === "event" && this._snoopedEvents.has(message.name)) {
			let event = this._snoopedEvents.get(message.name);
			event.handler(event.eventFromJSON(message.data), message.src, message.dst).catch(err => {
				logger.error(`Unexpected error snooping ${message.name}:\n${err.stack}`);
			});
		}

		if (!message.dst.addressedTo(this.connector.src)) {
			this._routeMessage(message);
			return;
		}

		if (message.type === "request") {
			let request = this._registeredRequests.get(message.name);
			if (!request) {
				this.connector.sendResponseError(
					new libData.ResponseError(`Unrecognized request ${message.name}`),
					message.src,
				);
				return;
			}
			this._processRequest(message, request);

		} else if (message.type === "response") {
			this._processResponse(message);

		} else if (message.type === "responseError") {
			this._processResponseError(message);

		} else if (message.type === "event") {
			this._processEvent(message);
		}
	}

	_routeMessage(message) {
		if (!this.router) {
			let err = new libErrors.InvalidMessage(
				`Received message addressed to ${message.dst} but this link does not route messages`
			);
			if (message.type === "request") {
				this.connector.sendResponseError(
					new libData.ResponseError(err.message, err.code), message.src
				);
			}
			throw err;
		}

		let fallback = this._fallbackedRequests.get(message.name);
		if (this.router.forwardMessage(this, message, Boolean(fallback))) {
			return;
		}
		if (!fallback) {
			throw new Error("Router requested fallback handling when fallback is unavailable");
		}
		if (message.type !== "request") {
			throw new Error(`Router requested fallback handling of unsupported message type ${message.type}`);
		}
		this._processRequest(message, fallback);
	}

	_processRequest(message, request) {
		if (!request.handler) {
			this.connector.sendResponseError(
				new libData.ResponseError(`No handler registered for ${request.Request.name}`), message.src
			);
			return;
		}

		let response;
		try {
			response = request.handler(request.requestFromJSON(message.data), message.src, message.dst);
		} catch (err) {
			if (err.errors) {
				logger.error(JSON.stringify(err.errors, null, 4));
			}
			this.connector.sendResponseError(
				new libData.ResponseError(err.message, err.code, err.stack), message.src
			);
			return;
		}

		if (!(response instanceof Promise)) {
			response = Promise.resolve(response);
		}

		response.then(
			result => {
				if (this.validateSent) {
					if (request.Response) {
						request.responseFromJSON(JSON.parse(JSON.stringify(result)));
					} else if (result !== undefined) {
						throw new Error(`Expected empty response from ${request.Request.name} handler`);
					}
				}
				this.connector.sendResponse(result, message.src);
			}
		).catch(
			err => {
				if (!(err instanceof libErrors.RequestError)) {
					logger.error(`Unexpected error responding to ${message.name}:\n${err.stack}`);
				}
				this.connector.sendResponseError(
					new libData.ResponseError(err.message, err.code, err.stack), message.src
				);
			}
		);
	}

	_processResponse(message) {
		let pending = this._pendingRequests.get(message.dst.requestId);
		if (!pending) {
			throw new libErrors.InvalidMessage(
				`Received response ${message.dst.requestId} without a pending request`
			);
		}

		try {
			pending.resolve(pending.request.responseFromJSON(message.data));
		} catch (err) {
			// An invalid response object was likely received
			pending.reject(err);
		}
	}

	_processResponseError(message) {
		let pending = this._pendingRequests.get(message.dst.requestId);
		if (!pending) {
			throw new libErrors.InvalidMessage(
				`Received error response ${message.dst.requestId} without a pending request`
			);
		}

		pending.reject(new libErrors.RequestError(message.data.message, message.data.code, message.data.stack));
	}

	_processEvent(message) {
		let event = this._registeredEvents.get(message.name);
		if (!event) {
			throw new libErrors.InvalidMessage(`Unrecognized event ${message.name}`);
		}

		if (!event.handler) {
			return;
		}
		event.handler(event.eventFromJSON(message.data), message.src, message.dst).catch(err => {
			logger.error(`Unexpected error handling ${message.name}:\n${err.stack}`);
		});
	}

	/**
	 * Prepare connection for disconnect
	 *
	 * Waits for all pending requests on the connection to resolve.
	 * Sub-classes should implement this handler with code that prevents
	 * additional requests to be sent out before calling the super class
	 * method.
	 */
	async prepareDisconnect() {
		let promises = [];
		for (let pending of this._pendingRequests.values()) {
			promises.push(pending.promise.then(() => {}, () => {}));
		}

		await Promise.all(promises);
	}

	/**
	 * Send a request or event to the other side of this link
	 * @param {*} requestOrEvent - Request or event to send
	 * @returns {Promise<*>|undefined}
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	send(requestOrEvent) {
		return this.sendTo(requestOrEvent, this.connector.dst);
	}

	/**
	 * Send a request or event to the given address
	 *
	 * @param {*} requestOrEvent - Request or event to send
	 * @param {*|module:lib/data.Address} destination - Where to send it
	 * @returns {Promise<*>|undefined}
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	sendTo(requestOrEvent, destination) {
		let dst = libData.Address.fromShorthand(destination);

		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequest(requestOrEvent, dst);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEvent(requestOrEvent, dst);
		}
		throw Error(`Expected request or event but got type ${requestOrEvent.constructor.type}`);
	}

	sendRequest(request, dst) {
		let name = request.constructor.name;
		if (!this._registeredRequests.has(name)) {
			// XXX should this be allowed?
			this.registerRequest(request.constructor);
		}
		let registeredRequest = this._registeredRequests.get(name);
		if (this.validateSent) {
			registeredRequest.requestFromJSON(JSON.parse(JSON.stringify(request)));
		}

		let pending = {
			request: registeredRequest,
		};
		pending.promise = new Promise((resolve, reject) => {
			pending.resolve = resolve;
			pending.reject = reject;
		});
		let requestId = this._nextRequestId;
		this._nextRequestId += 1;
		this._pendingRequests.set(requestId, pending);
		this.connector.sendRequest(request, requestId, dst);
		return pending.promise;
	}

	sendEvent(event, dst) {
		if (this.validateSent) {
			let name = event.constructor.name;
			if (!this._registeredEvents.has(name)) {
				// XXX should this be allowed?
				this.registerEvent(event.constructor);
			}
			this._registeredEvents.get(name).eventFromJSON(JSON.parse(JSON.stringify(event)));
		}

		this.connector.sendEvent(event, dst);
	}

	register(Class, handler) {
		if (Class.type === "request") {
			this.registerRequest(Class, handler);
		} else if (Class.type === "event") {
			this.registerEvent(Class, handler);
		} else {
			throw new Error(`Class ${Class.name} has unrecognized type ${Class.type}`);
		}
	}

	_requestEntry(Request, handler) {
		let name = Request.name;
		let entry = {
			Request,
			handler,
		};
		if (Request.fromJSON) {
			if (!Request.jsonSchema) {
				throw new Error(`Request ${name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Request.jsonSchema);
			entry.requestFromJSON = (json) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Request ${name} failed validation`, validate.errors);
				}
				return Request.fromJSON(json);
			};
		} else if (Request.jsonSchema) {
			throw new Error(`Request ${name} has static jsonSchema but is missing static fromJSON`);
		} else {
			entry.requestFromJSON = () => new Request();
		}

		let Response = Request.Response;
		if (Response) {
			if (!Response.jsonSchema) {
				throw new Error(`Response for Request ${name} is missing static jsonSchema`);
			}
			if (!Response.fromJSON) {
				throw new Error(`Response for Request ${name} is missing static fromJSON`);
			}

			let validate = libSchema.compile(Response.jsonSchema);
			entry.responseFromJSON = (json) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(
						`Response for request ${name} failed validation`, validate.errors
					);
				}
				return Response.fromJSON(json);
			};

			entry.Response = Response;
		} else {
			entry.responseFromJSON = () => undefined;
		}
		return entry;
	}

	registerRequest(Request, handler) {
		let name = Request.name;
		if (this._registeredRequests.has(name)) {
			throw new Error(`Request ${name} is already registered`);
		}
		let request = this._requestEntry(Request, handler);
		this._registeredRequests.set(name, request);
	}

	fallbackRequest(Request, handler) {
		let name = Request.name;
		if (this._fallbackedRequests.has(name)) {
			throw new Error(`Request ${name} is already fallbacked`);
		}
		let request = this._requestEntry(Request, handler);
		this._fallbackedRequests.set(name, request);
	}

	_createEventFromJSON(Event) {
		if (Event.fromJSON) {
			if (!Event.jsonSchema) {
				throw new Error(`Event ${Event.name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Event.jsonSchema);
			return (json) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Event ${Event.name} failed validation`, validate.errors);
				}
				return Event.fromJSON(json);
			};
		}
		if (Event.jsonSchema) {
			throw new Error(`Event ${Event.name} has static jsonSchema but is missing static fromJSON`);
		}
		return () => new Event();
	}

	registerEvent(Event, handler) {
		if (this._registeredEvents.has(Event.name)) {
			throw new Error(`Event ${Event.name} is already registered`);
		}
		let event = {
			Event,
			handler,
			eventFromJSON: this._createEventFromJSON(Event),
		};
		this._registeredEvents.set(Event.name, event);
	}

	snoopEvent(Event, handler) {
		let name = Event.name;
		if (this._snoopedEvents.has(name)) {
			throw new Error(`Event ${name} is already snooped`);
		}
		let event = {
			Event,
			handler,
			eventFromJSON: this._createEventFromJSON(Event),
		};
		this._snoopedEvents.set(Event.name, event);
	}
}


module.exports = {
	Link,
};
