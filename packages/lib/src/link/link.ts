// Implementation of Link class
import * as libData from "../data";
import * as libErrors from "../errors";
import { logger } from "../logging";
import * as libSchema from "../schema";
import { dataClasses } from "./messages";
import { BaseConnector, WebSocketBaseConnector } from "./connectors";
import { strict as assert } from "assert";
import type { PluginNodeEnvInfo, PluginWebpackEnvInfo } from "../plugin";
import type {
	AddressType, JSONDeserialisable, MessageRoutable, MessageRequest, MessageEvent, IControllerUser,
} from "../data";

export interface Request<Req, Res> {
	constructor: Partial<JSONDeserialisable<Req & Request<Req, Res>>> & {
		new (...args: any): Req & Request<Req, Res>,
		name: string,
		type: "request";
		src: AddressType | readonly AddressType[];
		dst: AddressType | readonly AddressType[];
		permission?: null | string | ((user: IControllerUser, message: MessageRequest) => void);
		plugin?: string;
		Response?: JSONDeserialisable<Res>,
	}
}
export type RequestClass<Req, Res> = Request<Req, Res>["constructor"];

export interface Event<T> {
	constructor: Partial<JSONDeserialisable<T & Event<T>>> & {
		new (...args: any): T & Event<T>,
		name: string,
		type: "event";
		src: AddressType | readonly AddressType[];
		dst: AddressType | readonly AddressType[];
		permission?: null | string | ((user: IControllerUser, message: MessageEvent) => void);
		plugin?: string;
	}
}
export type EventClass<T> = Event<T>["constructor"];

export interface RequestEntry {
	Request: RequestClass<unknown, unknown>;
	name: string,
	allowedSrcTypes: Set<number>;
	allowedDstTypes: Set<number>;
	requestFromJSON: (json: any) => Request<unknown, unknown>;
	Response?: any;
	responseFromJSON: (json: any) => any;
}

interface PendingRequest {
	promise: Promise<any>;
	request: RequestEntry;
	resolve: (result: any) => void;
	reject: (err: Error) => void;
	dst: libData.Address;
}
interface ForwardedRequest {
	origin: Link;
	src: libData.Address;
	dst: libData.Address;
}

export interface EventEntry {
	Event: EventClass<unknown>;
	name: string,
	allowedSrcTypes: Set<number>;
	allowedDstTypes: Set<number>;
	eventFromJSON: (json: any) => Event<unknown>;
}
export type RequestHandler<Req, Res> = (request: Req, src: libData.Address, dst: libData.Address) => Promise<Res>;
export type EventHandler<T> = (event: T, src: libData.Address, dst: libData.Address) => Promise<void>;

interface Router {
	forwardMessage(
		origin: Link,
		message: MessageRoutable,
		entry: RequestEntry | EventEntry | undefined,
		fallback: boolean,
	): boolean,
}

// Some definitions for the terminology used here:
// link: Either side of a controller - client connection
// connector: Adapter between a link and a socket connection
// connection: the controller side of a link
// client: the side that is not the controller of a link
// message: the complete object sent using the 'message' event

/**
 * Common interface for server and client connections
 */
export class Link {
	router?: Router = undefined;
	validateSent = true;

	_requestHandlers = new Map<RequestClass<unknown, unknown>, RequestHandler<unknown, unknown>>();
	_requestFallbacks = new Map<RequestClass<unknown, unknown>, RequestHandler<unknown, unknown>>();
	_eventHandlers = new Map<EventClass<unknown>, EventHandler<unknown>>();
	_eventSnoopers = new Map<EventClass<unknown>, EventHandler<unknown>>();
	_pendingRequests = new Map<number, PendingRequest>();
	_forwardedRequests = new Map<string, ForwardedRequest>();
	_nextRequestId = 1;

	constructor(
		public connector: BaseConnector
	) {
		this.handle(libData.PingRequest, async () => {});

		// Prevent warnings about possible memory leak due to large number of event listeners
		connector.setMaxListeners(20);

		// Process messages received by the connector
		connector.on("message", payload => {
			try {
				this._processMessage(payload as MessageRoutable);
			} catch (err) {
				if (err instanceof libErrors.InvalidMessage) {
					logger.error(err.message);
					if (err.errors) {
						logger.error(JSON.stringify(err.errors, null, "\t"));
					}

				} else {
					// Unexpected error, bubble back to connector
					this.connector.emit("error", err);
				}
			}
		});

		// The events below exist only on websocket connectors, we can't early return because of test mocking
		const webSocketConnector = this.connector as WebSocketBaseConnector;
		connector.on("disconnectPrepare", () => {
			this.prepareDisconnect().finally(() => {
				if (webSocketConnector.hasSession) {
					webSocketConnector.sendDisconnectReady();
				}
			}).catch(err => {
				logger.error(`Unexpected error preparing disconnect:\n${err.stack}`);
			});
		});

		connector.on("invalidate", () => {
			this._clearPendingRequests(new libErrors.SessionLost("Session Lost"));
		});

		connector.on("close", () => {
			this._clearPendingRequests(new libErrors.SessionLost("Session Closed"));
		});
	}

	/**
	 * Count of requests currently waiting for a response on this link
	 */
	get pendingRequestCount() {
		return this._pendingRequests.size + this._forwardedRequests.size;
	}

	_clearPendingRequests(err: Error & { code?: string }) {
		for (let pending of this._pendingRequests.values()) {
			pending.reject(err);
		}
		for (let pending of this._forwardedRequests.values()) {
			// Drop response if the origin is a WebSocket and the session
			// has expired.  The other end of the link will have sent an
			// error response to the request in this case.
			if (
				pending.origin.connector instanceof WebSocketBaseConnector
				&& !pending.origin.connector.hasSession
			) {
				continue;
			}
			pending.origin.connector.sendResponseError(
				new libData.ResponseError(err.message, err.code), pending.src, pending.dst
			);
		}
		this._pendingRequests.clear();
		this._forwardedRequests.clear();
	}

	/**
	 * Process a received message on the link
	 *
	 * Validates and invokes the handler and/or waiters for a message that has
	 * been received.  An unhandled message is considered to be an error.
	 *
	 * @param message - Message to process.
	 * @throws {libErrors.InvalidMessage} if the message is invalid or not handled.
	 */
	_processMessage(
		message: MessageRoutable
	) {
		if (!["request", "response", "responseError", "event"].includes(message.type)) {
			throw new libErrors.InvalidMessage(`Unhandled message type ${message.type}`);
		}

		let entry = this._validateMessage(message);
		if (entry && this.connector.dst.type === libData.Address.control) {
			try {
				this.validatePermission(
					message as libData.MessageRequest | libData.MessageEvent,
					entry
				); // Somewhat hacky, defined in ControlConnection
			} catch (err) {
				if (err instanceof libErrors.PermissionError) {
					return;
				}
				throw err;
			}
		}

		if (message.type === "event" && this._eventSnoopers.has((entry as EventEntry).Event)) {
			let handler = this._eventSnoopers.get((entry as EventEntry).Event)!;
			let event = message as libData.MessageEvent;
			handler((entry as EventEntry).eventFromJSON(event.data), event.src, event.dst).catch((err: Error) => {
				logger.error(`Unexpected error snooping ${event.name}:\n${err.stack}`);
			});
		}

		if (!message.dst.addressedTo(this.connector.src)) {
			if (message.type === "response" || message.type === "responseError") {
				this._forwardedRequests.delete(message.dst.index());
			}
			this._routeMessage(message, entry);
			return;
		}

		if (message.type === "request") {
			this._processRequest(
				message as libData.MessageRequest,
				entry as RequestEntry,
				this._requestHandlers.get((entry as RequestEntry).Request)
			);

		} else if (message.type === "response") {
			this._processResponse(message as libData.MessageResponse);

		} else if (message.type === "responseError") {
			this._processResponseError(message as libData.MessageResponseError);

		} else if (message.type === "event") {
			this._processEvent(
				message as libData.MessageEvent,
				entry as EventEntry
			);
		}
	}

	/**
	 * Ingress message validation
	 *
	 * Should be overridden by sub-classes to validate messages received.
	 *
	 * @param message - Message to check.
	 * @throws {libErrors.InvalidMessage} if the message is invalid.
	 */
	validateIngress(message: MessageRoutable) { }

	_validateMessage(
		message: MessageRoutable
	) {
		try {
			if (message.src.type === libData.Address.broadcast) {
				throw new libErrors.InvalidMessage("Message src may not be broadcast");
			}
			this.validateIngress(message);
		} catch (err: any) {
			if (message.type === "request") {
				this.connector.sendResponseError(new libData.ResponseError(err.message, err.code), message.src);
			}
			throw err;
		}

		if (message.type === "request") {
			assert(message instanceof libData.MessageRequest);
			let entry = Link._requestsByName.get(message.name);
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
			assert(message instanceof libData.MessageEvent);
			let entry = Link._eventsByName.get(message.name);
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

	/**
	 * Message permission validation
	 *
	 * Called when an request or event is received by a control connector.
	 * Should be overridden by sub-classes to validate messages received.
	 *
	 * @param message - Message to check.
	 * @param entry - Request or Event entry for this Message.
	 * @throws {libErrors.PermissionError} if unauthorized.
	 */
	validatePermission(message: libData.MessageRequest | libData.MessageEvent, entry: RequestEntry | EventEntry) { }

	_routeMessage(message: MessageRoutable, entry?: RequestEntry | EventEntry) {
		if (!this.router) {
			let err = new libErrors.InvalidMessage(
				`Received message addressed to ${(message as libData.MessageRequest).dst} but this link `+
				"does not route messages"
			);
			if (message.type === "request") {
				this.connector.sendResponseError(
					new libData.ResponseError(err.message, err.code), (message as libData.MessageRequest).src
				);
			}
			throw err;
		}

		let fallback =
			message.type === "request" ? this._requestFallbacks.get((entry as RequestEntry).Request) : undefined
		;
		if (this.router.forwardMessage(this, message, entry, Boolean(fallback))) {
			return;
		}
		if (!fallback) {
			throw new Error("Router requested fallback handling when fallback is unavailable");
		}
		if (message.type !== "request") {
			throw new Error(`Router requested fallback handling of unsupported message type ${message.type}`);
		}
		this._processRequest(
			message as libData.MessageRequest,
			entry as RequestEntry,
			fallback,
			(message as libData.MessageRequest).dst
		);
	}

	_processRequest(
		message: libData.MessageRequest,
		entry: RequestEntry,
		handler?: RequestHandler<unknown, unknown>,
		spoofedSrc?: libData.Address
	) {
		if (!handler) {
			this.connector.sendResponseError(
				new libData.ResponseError(`No handler for ${entry.Request.name}`), message.src
			);
			return;
		}

		let response: any;
		try {
			response = handler(entry.requestFromJSON(message.data), message.src, message.dst);
		} catch (err: any) {
			if (err.errors) {
				logger.error(JSON.stringify(err.errors, null, "\t"));
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
			(result: any) => {
				if (this.validateSent) {
					if (entry.Response) {
						entry.responseFromJSON(JSON.parse(JSON.stringify(result)));
					} else if (result !== undefined) {
						throw new Error(`Expected empty response from ${entry.Request.name} handler`);
					}
				}
				this.connector.sendResponse(result, message.src, spoofedSrc);
			}
		).catch(
			(err: Error & { code?: string }) => {
				if (err instanceof libErrors.InvalidMessage) {
					logger.error(err.message);
					if (err.errors) {
						logger.error(JSON.stringify(err.errors, null, "\t"));
					}
				} else if (!(err instanceof libErrors.RequestError)) {
					logger.error(`Unexpected error responding to ${message.name}:\n${err.stack}`);
				}
				try {
					this.connector.sendResponseError(
						new libData.ResponseError(err.message, err.code, err.stack), message.src, spoofedSrc
					);
				} catch (subErr: any) {
					logger.error(`Unexpected error sending error response for ${message.name}:\n${subErr.stack}`);
				}
			}
		);
	}

	_processResponse(message: libData.MessageResponse) {
		let pending = this._pendingRequests.get(message.dst.requestId!);
		if (!pending) {
			throw new libErrors.InvalidMessage(
				`Received response ${message.dst.requestId} without a pending request`
			);
		}

		if (!pending.dst.equals(message.src)) {
			throw new libErrors.InvalidMessage(`Received reply from ${message.src} for message sent to ${pending.dst}`);
		}

		this._pendingRequests.delete(message.dst.requestId!);
		try {
			pending.resolve(pending.request.responseFromJSON(message.data));
		} catch (err: any) {
			// An invalid response object was likely received
			pending.reject(err);
		}
	}

	_processResponseError(message: libData.MessageResponseError) {
		let pending = this._pendingRequests.get(message.dst.requestId!);
		if (!pending) {
			throw new libErrors.InvalidMessage(
				`Received error response ${message.dst.requestId} without a pending request`
			);
		}

		this._pendingRequests.delete(message.dst.requestId!);
		pending.reject(new libErrors.RequestError(message.data.message, message.data.code, message.data.stack));
	}

	_processEvent(message: libData.MessageEvent, entry: EventEntry) {
		let handler = this._eventHandlers.get(entry.Event);
		if (!handler) {
			throw new libErrors.InvalidMessage(`Unhandled event ${message.name}`);
		}

		handler(
			entry.eventFromJSON(message.data), message.src, message.dst
		).catch((err: Error) => {
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
	 * @param requestOrEvent - Request or event to send
	 * @returns
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	send<Req, Res = void>(requestOrEvent: Request<Req, Res>): Promise<Res>;
	send<T>(requestOrEvent: Event<T>): void;
	send(requestOrEvent: Request<unknown, unknown> | Event<unknown>): Promise<unknown> | void {
		return this.sendTo(this.connector.dst, requestOrEvent as any);
	}

	/**
	 * Send a request or event to the given address
	 *
	 * @param destination - Where to send it
	 * @param requestOrEvent - Request or event to send
	 * @returns
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	sendTo<Req, Res = void>(destination: libData.AddressShorthand, requestOrEvent: Request<Req, Res>): Promise<Res>;
	sendTo<T>(destination: libData.AddressShorthand, requestOrEvent: Event<T>): void;
	sendTo(
		destination: libData.AddressShorthand,
		requestOrEvent: Request<unknown, unknown> | Event<unknown>,
	): Promise<unknown> | void {
		let dst = libData.Address.fromShorthand(destination);

		// TODO investigate if these types can be inferred
		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequest(requestOrEvent as Request<unknown, unknown>, dst);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEvent(requestOrEvent as Event<unknown>, dst);
		}
		throw Error(`Expected request or event but got type ${(requestOrEvent.constructor as any).type}`);
	}

	sendRequest<Req, Res>(request: Request<Req, Res>, dst: libData.Address) {
		let entry = Link._requestsByClass.get(request.constructor as RequestClass<unknown, unknown>);
		if (!entry) {
			throw new Error(`Attempt to send unregistered Request ${request.constructor.name}`);
		}
		if (this.connector.src.addressedTo(dst)) {
			throw new Error(`Message would return back to sender ${dst}.`);
		}
		if (this.validateSent) {
			entry.requestFromJSON(JSON.parse(JSON.stringify(request)));
		}

		let resolve: (value: unknown) => void;
		let reject: (reason: any) => void;
		let promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		let requestId = this._nextRequestId;
		this._nextRequestId += 1;
		this._pendingRequests.set(
			requestId, { request: entry, promise, resolve: resolve!, reject: reject!, dst }
		);
		this.connector.sendRequest(request, requestId, dst);
		return promise;
	}

	forwardRequest(message: libData.MessageRequest, origin: Link) {
		let pending = {
			origin,
			src: message.src,
			dst: message.dst,
		};
		this._forwardedRequests.set(message.src.index(), pending);
		this.connector.forward(message);
	}

	sendEvent<T>(event: Event<T>, dst: libData.Address) {
		let entry = Link._eventsByClass.get(event.constructor as EventClass<unknown>);
		if (!entry) {
			throw new Error(`Attempt to send unregistered Event ${event.constructor.name}`);
		}
		if (this.connector.src.addressedTo(dst)) {
			throw new Error(`Message would return back to sender ${dst}.`);
		}
		if (this.validateSent) {
			entry.eventFromJSON(JSON.parse(JSON.stringify(event)));
		}

		this.connector.sendEvent(event, dst);
	}

	handle<Req, Res>(Class: RequestClass<Req, Res>, handler: RequestHandler<Req, Res>): void;
	handle<T>(Class: EventClass<T>, handler: EventHandler<T>): void;
	handle(
		Class: RequestClass<unknown, unknown> | EventClass<unknown>,
		handler: RequestHandler<unknown, unknown> | EventHandler<unknown>,
	) {
		if (Class.type === "request") {
			this.handleRequest(Class, handler as RequestHandler<unknown, unknown>);
		} else if (Class.type === "event") {
			this.handleEvent(Class, handler as EventHandler<unknown>);
		} else {
			throw new Error(`Class ${(Class as any).name} has unrecognized type ${(Class as any).type}`);
		}
	}

	handleRequest<Req, Res>(Request: RequestClass<Req, Res>, handler: RequestHandler<Req, Res>) {
		let entry = Link._requestsByClass.get(Request as RequestClass<unknown, unknown>);
		if (!entry) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._requestHandlers.has(Request)) {
			throw new Error(`Request ${entry.name} is already registered`);
		}
		this._requestHandlers.set(Request, handler as RequestHandler<unknown, unknown>);
	}

	fallbackRequest<Req, Res>(Request: RequestClass<Req, Res>, handler: RequestHandler<Req, Res>) {
		let entry = Link._requestsByClass.get(Request as RequestClass<unknown, unknown>);
		if (!entry) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._requestFallbacks.has(Request)) {
			throw new Error(`Request ${entry.name} is already fallbacked`);
		}
		this._requestFallbacks.set(Request, handler as RequestHandler<unknown, unknown>);
	}

	handleEvent<T>(Event: EventClass<T>, handler: EventHandler<T>) {
		let entry = Link._eventsByClass.get(Event as EventClass<unknown>);
		if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._eventHandlers.has(Event)) {
			throw new Error(`Event ${entry.name} is already registered`);
		}
		this._eventHandlers.set(Event, handler as EventHandler<unknown>);
	}

	snoopEvent<T>(Event: EventClass<T>, handler: EventHandler<T>) {
		let entry = Link._eventsByClass.get(Event as EventClass<unknown>);
		if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._eventSnoopers.has(Event)) {
			throw new Error(`Event ${entry.name} is already snooped`);
		}
		this._eventSnoopers.set(Event, handler as EventHandler<unknown>);
	}

	static register<Req, Res>(Class: RequestClass<Req, Res>): void;
	static register<T>(Class: EventClass<T>): void;
	static register(Class: RequestClass<unknown, unknown> | EventClass<unknown>) {
		if (Class.type === "request") {
			this.registerRequest(Class);
		} else if (Class.type === "event") {
			this.registerEvent(Class);
		} else {
			throw new Error(`Data class ${(Class as any).name} has unknown type ${(Class as any).type}`);
		}
	}

	static requestFromJSON<Req, Res>(Request: RequestClass<Req, Res>, name: string): (json: any) => Request<Req, Res> {
		if (Request.fromJSON) {
			if (!Request.jsonSchema) {
				throw new Error(`Request ${name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Request.jsonSchema as any);
			return (json: any) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Request ${name} failed validation`, validate.errors);
				}
				return Request.fromJSON!(json);
			};
		}
		if (Request.jsonSchema) {
			throw new Error(`Request ${name} has static jsonSchema but is missing static fromJSON`);
		}
		return () => new Request();
	}

	static responseFromJSON<T>(Response: Partial<JSONDeserialisable<T>>, name: string) {
		if (!Response.jsonSchema) {
			throw new Error(`Response for Request ${name} is missing static jsonSchema`);
		}
		if (!Response.fromJSON) {
			throw new Error(`Response for Request ${name} is missing static fromJSON`);
		}

		let validate = libSchema.compile(Response.jsonSchema as any);
		return (json: any) => {
			if (!validate(json)) {
				throw new libErrors.InvalidMessage(
					`Response for request ${name} failed validation`, validate.errors
				);
			}
			return Response.fromJSON!(json);
		};
	}

	static allowedTypes(
		types: libData.AddressType | readonly libData.AddressType[] | undefined,
		name: string,
		side: "src" | "dst"
	) {
		if (types === undefined) {
			throw new Error(`Missing ${side} specification in ${name}`);
		}

		if (!(types instanceof Array)) {
			types = [types];
		}

		let allowed = new Set<number>();
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

	static _requestsByName = new Map<string, RequestEntry>();
	static _requestsByClass = new Map<RequestClass<unknown, unknown>, RequestEntry>();

	static registerRequest(Request: RequestClass<unknown, unknown>) {
		const name = Request.plugin ? `${Request.plugin}:${Request.name}` : Request.name;
		if (this._requestsByName.has(name)) {
			throw new Error(`Request ${name} is already registered`);
		}

		let entry: RequestEntry = {
			Request,
			name,
			requestFromJSON: this.requestFromJSON(Request, name),
			allowedSrcTypes: this.allowedTypes(Request.src, name, "src"),
			allowedDstTypes: this.allowedTypes(Request.dst, name, "dst"),
			responseFromJSON: (_json: any) => undefined,
		};

		if (
			entry.allowedSrcTypes.has(libData.Address.control)
			&& !(Request.permission === null || ["function", "string"].includes(typeof Request.permission))
		) {
			throw new Error(`Invalid permission specification ${typeof Request.permission} on ${name}`);
		}

		let Response = Request.Response;
		if (Response) {
			entry.Response = Response;
			entry.responseFromJSON = this.responseFromJSON(Response, name);
		}

		this._requestsByName.set(name, entry);
		this._requestsByClass.set(Request, entry);
	}

	static eventFromJSON<T>(Event: EventClass<T>, name: string) {
		if (Event.fromJSON) {
			if (!Event.jsonSchema) {
				throw new Error(`Event ${name} has static fromJSON but is missing static jsonSchema`);
			}
			let validate = libSchema.compile(Event.jsonSchema as any);
			return (json: any) => {
				if (!validate(json)) {
					throw new libErrors.InvalidMessage(`Event ${name} failed validation`, validate.errors);
				}
				return Event.fromJSON!(json);
			};
		}
		if (Event.jsonSchema) {
			throw new Error(`Event ${name} has static jsonSchema but is missing static fromJSON`);
		}
		return (json: any) => new Event();
	}

	static _eventsByName = new Map<string, EventEntry>();
	static _eventsByClass = new Map<EventClass<unknown>, EventEntry>();

	static registerEvent<T>(Event: EventClass<T>) {
		const name = Event.plugin ? `${Event.plugin}:${Event.name}` : Event.name;
		if (this._eventsByName.has(name)) {
			throw new Error(`Event ${name} is already registered`);
		}

		let entry: EventEntry = {
			Event: Event as EventClass<unknown>,
			name,
			eventFromJSON: this.eventFromJSON(Event, name),
			allowedSrcTypes: this.allowedTypes(Event.src, name, "src"),
			allowedDstTypes: this.allowedTypes(Event.dst, name, "dst"),
		};

		if (
			entry.allowedSrcTypes.has(libData.Address.control)
			&& !(Event.permission === null || ["function", "string"].includes(typeof Event.permission))
		) {
			throw new Error(`Invalid permission specification ${typeof Event.permission} on ${name}`);
		}

		this._eventsByName.set(name, entry);
		this._eventsByClass.set(Event as EventClass<unknown>, entry);
	}
}

for (let Class of dataClasses) {
	Link.register(Class as RequestClass<unknown, unknown>);
}

export function registerPluginMessages(pluginInfos: PluginNodeEnvInfo[]|PluginWebpackEnvInfo[]) {
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
