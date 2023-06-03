// Implementation of Link class
"use strict";

const libData = require("../data");
const libErrors = require("../errors");
const { logger } = require("../logging");
const libSchema = require("../schema");
const { dataClasses } = require("./messages");

// Some definitions for the terminology used here:
// link: Either side of a controller - client connection
// connector: Adapter between a link and a socket connection
// connection: the controller side of a link
// client: the side that is not the controller of a link
// message: the complete object sent using the 'message' event

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

		this._requestHandlers = new Map();
		this._requestFallbacks = new Map();
		this._eventHandlers = new Map();
		this._eventSnoopers = new Map();
		this._pendingRequests = new Map();
		this._nextRequestId = 1;

		this.handle(libData.PingRequest, () => {});

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

		let entry = this._validateMessage(message);

		if (message.type === "event" && this._eventSnoopers.has(entry.Event)) {
			let handler = this._eventSnoopers.get(entry.Event);
			handler(entry.eventFromJSON(message.data), message.src, message.dst).catch(err => {
				logger.error(`Unexpected error snooping ${message.name}:\n${err.stack}`);
			});
		}

		if (!message.dst.addressedTo(this.connector.src)) {
			this._routeMessage(message, entry);
			return;
		}

		if (message.type === "request") {
			this._processRequest(message, entry, this._requestHandlers.get(entry.Request));

		} else if (message.type === "response") {
			this._processResponse(message);

		} else if (message.type === "responseError") {
			this._processResponseError(message);

		} else if (message.type === "event") {
			this._processEvent(message, entry);
		}
	}

	_validateMessage(message) {
		if (message.type === "request") {
			let entry = this.constructor._requestsByName.get(message.name);
			if (!entry) {
				let err = new libErrors.InvalidMessage(`Unrecognized request ${message.name}`);
				this.connector.sendResponseError(new libData.ResponseError(err.message, err.code), message.src);
				throw err;
			}
			if (!entry.allowedSrcTypes.has(message.src.type)) {
				let err = new libErrors.InvalidMessage(`Source ${message.src} is not allowed for ${message.name}`);
				this.connector.sendResponseError(new libData.ResponseError(err.message, err.code), message.src);
				throw err;
			}
			if (!entry.allowedDstTypes.has(message.dst.type)) {
				let err = new libErrors.InvalidMessage(`Destination ${message.dst} is not allowed for ${message.name}`);
				this.connector.sendResponseError(new libData.ResponseError(err.message, err.code), message.src);
				throw err;
			}
			return entry;

		} else if (message.type === "response") {
			return undefined;

		} else if (message.type === "responseError") {
			return undefined;

		} else if (message.type === "event") {
			let entry = this.constructor._eventsByName.get(message.name);
			if (!entry) {
				throw new libErrors.InvalidMessage(`Unrecognized event ${message.name}`);
			}
			if (!entry.allowedSrcTypes.has(message.src.type)) {
				throw new libErrors.InvalidMessage(`Source ${message.src} is not allowed for ${message.name}`);
			}
			if (message.dst.type === libData.Address.broadcast) {
				if (!entry.allowedDstTypes.has(message.dst.id)) {
					throw new libErrors.InvalidMessage(`Destination ${message.dst} is not allowed for ${message.name}`);
				}
			} else {
				// eslint-disable-next-line no-lonely-if
				if (!entry.allowedDstTypes.has(message.dst.type)) {
					throw new libErrors.InvalidMessage(`Destination ${message.dst} is not allowed for ${message.name}`);
				}
			}
			return entry;
		}

		throw new Error("Should be unreachable");
	}

	_routeMessage(message, entry) {
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

		let fallback = message.type === "request" ? this._requestFallbacks.get(entry.Request) : undefined;
		if (this.router.forwardMessage(this, message, Boolean(fallback))) {
			return;
		}
		if (!fallback) {
			throw new Error("Router requested fallback handling when fallback is unavailable");
		}
		if (message.type !== "request") {
			throw new Error(`Router requested fallback handling of unsupported message type ${message.type}`);
		}
		this._processRequest(message, entry, fallback);
	}

	_processRequest(message, entry, handler) {
		if (!handler) {
			this.connector.sendResponseError(
				new libData.ResponseError(`No handler for ${entry.Request.name}`), message.src
			);
			return;
		}

		let response;
		try {
			response = handler(entry.requestFromJSON(message.data), message.src, message.dst);
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
					if (entry.Response) {
						entry.responseFromJSON(JSON.parse(JSON.stringify(result)));
					} else if (result !== undefined) {
						throw new Error(`Expected empty response from ${entry.Request.name} handler`);
					}
				}
				this.connector.sendResponse(result, message.src);
			}
		).catch(
			err => {
				if (err instanceof libErrors.InvalidMessage) {
					logger.error(err.message);
					if (err.errors) {
						logger.error(JSON.stringify(err.errors, null, 4));
					}
				} else if (!(err instanceof libErrors.RequestError)) {
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

	_processEvent(message, entry) {
		let handler = this._eventHandlers.get(entry.Event);
		if (!handler) {
			throw new libErrors.InvalidMessage(`Unhandled event ${message.name}`);
		}

		handler(entry.eventFromJSON(message.data), message.src, message.dst).catch(err => {
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
		let entry = this.constructor._requestsByClass.get(request.constructor);
		if (!entry) {
			throw new Error(`Attempt to send unregistered Request ${request.constructor.name}`);
		}
		if (this.validateSent) {
			entry.requestFromJSON(JSON.parse(JSON.stringify(request)));
		}

		let pending = {
			request: entry,
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
		let entry = this.constructor._eventsByClass.get(event.constructor);
		if (!entry) {
			throw new Error(`Attempt to send unregistered Event ${event.constructor.name}`);
		}
		if (this.validateSent) {
			entry.eventFromJSON(JSON.parse(JSON.stringify(event)));
		}

		this.connector.sendEvent(event, dst);
	}

	handle(Class, handler) {
		if (Class.type === "request") {
			this.handleRequest(Class, handler);
		} else if (Class.type === "event") {
			this.handleEvent(Class, handler);
		} else {
			throw new Error(`Class ${Class.name} has unrecognized type ${Class.type}`);
		}
	}

	handleRequest(Request, handler) {
		let entry = this.constructor._requestsByClass.get(Request);
		if (!entry) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._requestHandlers.has(Request)) {
			throw new Error(`Request ${entry.name} is already registered`);
		}
		this._requestHandlers.set(Request, handler);
	}

	fallbackRequest(Request, handler) {
		let entry = this.constructor._requestsByClass.get(Request);
		if (!entry) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._requestFallbacks.has(Request)) {
			throw new Error(`Request ${entry.name} is already fallbacked`);
		}
		this._requestFallbacks.set(Request, handler);
	}

	handleEvent(Event, handler) {
		let entry = this.constructor._eventsByClass.get(Event);
		if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._eventHandlers.has(Event)) {
			throw new Error(`Event ${entry.name} is already registered`);
		}
		this._eventHandlers.set(Event, handler);
	}

	snoopEvent(Event, handler) {
		let entry = this.constructor._eventsByClass.get(Event);
		if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._eventSnoopers.has(Event)) {
			throw new Error(`Event ${entry.name} is already snooped`);
		}
		this._eventSnoopers.set(Event, handler);
	}

	static register(Class) {
		if (Class.type === "request") {
			this.registerRequest(Class);
		} else if (Class.type === "event") {
			this.registerEvent(Class);
		} else {
			throw new Error(`Data class ${Class.name} has unknown type ${Class.type}`);
		}
	}

	static requestFromJSON(Request, name) {
		if (Request.fromJSON) {
			if (!Request.jsonSchema) {
				throw new Error(`Request ${name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Request.jsonSchema);
			return (json) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Request ${name} failed validation`, validate.errors);
				}
				return Request.fromJSON(json);
			};
		}
		if (Request.jsonSchema) {
			throw new Error(`Request ${name} has static jsonSchema but is missing static fromJSON`);
		}
		return () => new Request();
	}

	static responseFromJSON(Response, name) {
		if (!Response.jsonSchema) {
			throw new Error(`Response for Request ${name} is missing static jsonSchema`);
		}
		if (!Response.fromJSON) {
			throw new Error(`Response for Request ${name} is missing static fromJSON`);
		}

		let validate = libSchema.compile(Response.jsonSchema);
		return (json) => {
			if (!validate(json)) {
				throw new libErrors.InvalidMessage(
					`Response for request ${name} failed validation`, validate.errors
				);
			}
			return Response.fromJSON(json);
		};
	}

	static allowedTypes(types, name, side) {
		if (types === undefined) {
			throw new Error(`Missing ${side} specification in ${name}`);
		}

		if (!(types instanceof Array)) {
			types = [types];
		}

		let allowed = new Set();
		for (let type of types) {
			let id = libData.Address[type];
			if (typeof id !== "number") {
				throw new Error(`Invalid type ${type} in ${side} specification of ${name}`);
			}
			if (id === libData.Address.broadcast) {
				throw new Error(`${side} specification may not use the broadcast type in ${name}`);
			}
			allowed.add(id);
		}
		return allowed;
	}

	static _requestsByName = new Map();
	static _requestsByClass = new Map();

	static registerRequest(Request) {
		const name = Request.plugin ? `${Request.plugin}:${Request.name}` : Request.name;
		if (this._requestsByName.has(name)) {
			throw new Error(`Request ${name} is already registered`);
		}

		let entry = {
			Request,
			name,
			requestFromJSON: this.requestFromJSON(Request, name),
			allowedSrcTypes: this.allowedTypes(Request.src, name, "src"),
			allowedDstTypes: this.allowedTypes(Request.dst, name, "dst"),
		};

		let Response = Request.Response;
		if (Response) {
			entry.Response = Response;
			entry.responseFromJSON = this.responseFromJSON(Response, name);
		} else {
			entry.responseFromJSON = () => undefined;
		}

		this._requestsByName.set(name, entry);
		this._requestsByClass.set(Request, entry);
	}

	static eventFromJSON(Event, name) {
		if (Event.fromJSON) {
			if (!Event.jsonSchema) {
				throw new Error(`Event ${name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Event.jsonSchema);
			return (json) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Event ${name} failed validation`, validate.errors);
				}
				return Event.fromJSON(json);
			};
		}
		if (Event.jsonSchema) {
			throw new Error(`Event ${name} has static jsonSchema but is missing static fromJSON`);
		}
		return () => new Event();
	}

	static _eventsByName = new Map();
	static _eventsByClass = new Map();

	static registerEvent(Event) {
		const name = Event.plugin ? `${Event.plugin}:${Event.name}` : Event.name;
		if (this._eventsByName.has(name)) {
			throw new Error(`Event ${name} is already registered`);
		}

		let entry = {
			Event,
			name,
			eventFromJSON: this.eventFromJSON(Event, name),
			allowedSrcTypes: this.allowedTypes(Event.src, name, "src"),
			allowedDstTypes: this.allowedTypes(Event.dst, name, "dst"),
		};
		this._eventsByName.set(name, entry);
		this._eventsByClass.set(Event, entry);
	}
}

for (let Class of dataClasses) {
	Link.register(Class);
}

function registerPluginMessages(pluginInfos) {
	for (let pluginInfo of pluginInfos) {
		for (let Class of pluginInfo.messages || []) {
			if (Class.plugin !== pluginInfo.name) {
				throw new Error(
					`Expected message ${Class.name} from ${pluginInfo.name} to have a static ` +
					`plugin property set to "${pluginInfo.name}"`
				);
			}
			Link.register(Class);
		}
	}
}


module.exports = {
	Link,
	registerPluginMessages,
};
