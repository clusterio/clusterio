import { Type, Static } from "@sinclair/typebox";
import { Link, Event, EventClass, RequestHandler, WebSocketBaseConnector } from "./link";
import { Address, MessageRequest, IUser, JsonBoolean, StringEnum } from "./data";
import isDeepStrictEqual from "./is_deep_strict_equal";
import { RequestError } from "./errors";
import { logger } from "./logging";

export type SubscriptionRequestHandler<T> = RequestHandler<SubscriptionRequest, Event<T> | null>;
export type EventSubscriberCallback<T> = (event: T | null, synced: boolean) => void

/**
 * Represents a set of string subscription filters.
 * When isAll() is true, all strings match this filter.
 * When isEmpty() is true, no strings match this filter.
 * Otherwise, literal string matching is performed against a set.
 */
export class SubscriptionFilters {
	private constructor(
		private _all: boolean,
		private _filters: Set<string>,
	) {}

	static jsonSchema = Type.Array(Type.String());

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(false, new Set(json));
	}

	toJSON() {
		return [...this._filters];
	}

	/** Creates a subscription filter accepting all strings */
	static all() {
		return new this(true, new Set());
	}

	isAll() {
		return this._all;
	}

	/** Creates a subscription filter rejecting all strings */
	static empty() {
		return new this(false, new Set());
	}

	isEmpty() {
		return !this._all && this._filters.size === 0;
	}

	/**
	 * Creates a subscription filter from undefined, string, or array of strings.
	 * Strings work as expected, undefined will produce a filter accepting all values.
	 * @param filters Shorthand representation
	 */
	static fromShorthand(filters?: string | string[]) {
		if (filters === undefined) {
			return this.all();
		}
		if (Array.isArray(filters)) {
			return new this(false, new Set(filters));
		}
		return new this(false, new Set([filters]));
	}

	toString() {
		if (this._all) {
			return "[SubscriptionFilters All]";
		}
		if (this._filters.size === 0) {
			return "[SubscriptionFilters Empty]";
		}
		return `[SubscriptionFilters Set<${this._filters.size}>]`;
	}

	/** Returns true if this filter accepts all the given filters */
	accepts(value: string) {
		return this._all || this._filters.has(value);
	}

	/** Returns true if this filter extends the other */
	extends(other: this) {
		return this._all || (!other._all && [...other._filters.values()].every(value => this._filters.has(value)));
	}

	/** Returns true if there is overlap between two filters */
	intersects(other: this) {
		if (this._all) {
			return !other.isEmpty();
		}
		if (other._all) {
			return !this.isEmpty();
		}
		for (const filter of other._filters) {
			if (this._filters.has(filter)) {
				return true;
			}
		}
		return false;
	}

	/** Add filters from a filter into this one. */
	union(other: this) {
		if (this._all) {
			return; // Already all
		}
		if (other._all) {
			this._all = true;
			this._filters.clear();
			return;
		}
		for (const filter of other._filters) {
			this._filters.add(filter);
		}
	}

	/**
	 * Remove filters in a filter from this one.
	 * You cannot subtract filters from a filter accepting all.
	 * Subtracting a filter accepting all produces an empty filter.
	 */
	subtract(other: this) {
		if (other._all) {
			this._all = false;
			this._filters.clear();
			return;
		}
		if (this._all) {
			return; // Cannot subtract from all
		}
		for (const filter of other._filters) {
			this._filters.delete(filter);
		}
	}
}

const SubscriptionActionSchema = StringEnum(["subscribe", "unsubscribe", "replace"]);
type SubscriptionAction = Static<typeof SubscriptionActionSchema>;

/**
 * A subscription request sent by a subscriber, this updates what events the subscriber will be sent
 * The permission for this request copies the permission from the event being subscribed to
 * subscribe: false will unsubscribe the subscriber from all notifications
 */
export class SubscriptionRequest {
	declare ["constructor"]: typeof SubscriptionRequest;
	static type = "request" as const;
	static src = ["control", "host", "instance"] as const;
	static dst = "controller" as const;
	static permission(user: IUser, message: MessageRequest) {
		if (typeof message.data === "object" && message.data !== null) {
			const data = message.data as Static<typeof this.jsonSchema>;
			const entry = Link._eventsByName.get(data[0]);
			if (entry && entry.Event.permission) {
				if (typeof entry.Event.permission === "string") {
					user.checkPermission(entry.Event.permission);
				} else {
					entry.Event.permission(user, message);
				}
			}
		}
	}

	/** Indicates if updates have been sent */
	static Response = JsonBoolean;
	public filters: SubscriptionFilters;
	public action: SubscriptionAction;

	/** @deprecated Use SubscriptionFilters and SubscriptionAction instead */
	constructor(
		eventName: string,
		subscribe: boolean,
		lastRequestTimeMs: number | undefined,
		filters?: string | string[],
	);

	constructor(
		eventName: string,
		action: SubscriptionAction,
		lastRequestTimeMs: number | undefined,
		filters?: SubscriptionFilters,
	);

	constructor(
		public eventName: string,
		action: boolean | SubscriptionAction,
		public lastRequestTimeMs: number = 0,
		filters: undefined | string | string[] | SubscriptionFilters,
	) {
		if (!Link._eventsByName.has(eventName)) {
			throw new Error(`Unregistered Event class ${eventName}`);
		}
		if (filters instanceof SubscriptionFilters) { // Easier migration for plugins
			this.filters = filters;
		} else {
			this.filters = SubscriptionFilters.fromShorthand(filters);
		}
		if (typeof action === "boolean") { // Easier migration for plugins
			this.action = action ? "subscribe" : "unsubscribe";
		} else {
			this.action = action;
		}
	}

	static jsonSchema = Type.Union([
		Type.Tuple([
			Type.String(),
			SubscriptionActionSchema,
			Type.Number(),
		]),
		Type.Tuple([
			Type.String(),
			SubscriptionActionSchema,
			Type.Number(),
			SubscriptionFilters.jsonSchema,
		]),
	]);

	toJSON() {
		if (!this.filters.isAll()) {
			return [this.eventName, this.action, this.lastRequestTimeMs, this.filters.toJSON()];
		}
		return [this.eventName, this.action, this.lastRequestTimeMs];
	}

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		const [eventName, action, lastRequestTimeMs, filters] = json;
		return new this(
			eventName,
			action,
			lastRequestTimeMs,
			filters ? SubscriptionFilters.fromJSON(filters) : SubscriptionFilters.all()
		);
	}
}

type Subscriber = {
	link: Link,
	dst: Address,
	filters: SubscriptionFilters,
}

type EventData = {
	subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
	subscriptions: Map<ReturnType<Address["addressIndex"]>, Subscriber>,
};

/**
 * A class component to handle incoming subscription requests and offers a method to broadcast events to subscribers
 * After creation, no other handler can be registered for SubscriptionRequest on the controller
 */
export class SubscriptionController {
	_events = new Map<string, EventData>();

	/**
	 * Allow clients to subscribe to an event by telling the subscription controller to accept them
	 * Has an optional subscription update handler which is called when a client subscribes
	 * @param Event - Event class which is sent out as updates.
	 * @param subscriptionUpdate -
	 *     Optional handler called when a client subscribes.
	 */
	handle<T>(Event: EventClass<T>, subscriptionUpdate?: SubscriptionRequestHandler<T>) {
		const entry = Link._eventsByClass.get(Event);
		if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._events.has(entry.name)) {
			throw new Error(`Event ${entry.name} is already registered`);
		}
		this._events.set(entry.name, {
			subscriptionUpdate: subscriptionUpdate,
			subscriptions: new Map(),
		});
	}

	/**
	 * Broadcast an event to all subscribers of that event
	 * @param event - Event to broadcast.
	 */
	broadcast<T extends Event<T>>(event: T & { filters?: string | string[] }, filters?: string | string[]) {
		const entry = Link._eventsByClass.get(event.constructor);
		if (!entry) {
			throw new Error(`Unregistered Event class ${event.constructor.name}`);
		}
		const eventData = this._events.get(entry.name);
		if (!eventData) {
			throw new Error(`Event ${entry.name} is not a registered as subscribable`);
		}

		const broadcastFilters = SubscriptionFilters.fromShorthand(filters ?? event.filters);
		for (const [addressIndex, subscriber] of eventData.subscriptions) {
			if ((subscriber.link.connector as WebSocketBaseConnector).closing) {
				eventData.subscriptions.delete(addressIndex);
				continue;
			}
			if (subscriber.filters.intersects(broadcastFilters)) {
				subscriber.link.sendTo(subscriber.dst, event);
			}
		}
	}

	/**
	 * Unsubscribe from all events of a given address.
	 * Used when an instance is stopped to stop all active subscriptions.
	 * @param address - Address to stop sending events to.
	 */
	unsubscribeAddress(address: Address) {
		const addressIndex = address.addressIndex();
		for (const eventData of this._events.values()) {
			eventData.subscriptions.delete(addressIndex);
		}
	}

	/**
	 * Unsubscribe from all events of a given link.
	 * Used when a link is closed to stop all active subscriptions.
	 * @param link - Link to stop sending events to.
	 */
	unsubscribeLink(link: Link) {
		for (const eventData of this._events.values()) {
			for (const [addressIndex, subscriber] of eventData.subscriptions) {
				if (subscriber.link === link) {
					eventData.subscriptions.delete(addressIndex);
				}
			}
		}
	}

	/**
	 * Handle incoming subscription requests on a link
	 * @param link - Link message was received on
	 * @param request - incoming request.
	 * @param src - Source address of incomming request.
	 * @param dst - destination address of incomming request.
	 */
	async handleRequest(link: Link, request: SubscriptionRequest, src: Address, dst: Address) {
		if (!Link._eventsByName.has(request.eventName)) {
			throw new Error(`Event ${request.eventName} is not a registered event`);
		}
		const eventData = this._events.get(request.eventName);
		if (!eventData) {
			throw new Error(`Event ${request.eventName} is not a registered as subscribable`);
		}
		const addressIndex = src.addressIndex();
		const subscriber = eventData.subscriptions.get(addressIndex);
		switch (request.action) {
			case "unsubscribe":
				if (!subscriber) {
					return false;
				}
				subscriber.filters.subtract(request.filters);
				if (subscriber.filters.isEmpty()) {
					eventData.subscriptions.delete(addressIndex);
				}
				break;

			case "subscribe":
				if (!subscriber) {
					eventData.subscriptions.set(addressIndex, { link: link, dst: src, filters: request.filters });
				} else {
					subscriber.filters.union(request.filters);
				}
				break;

			case "replace":
				if (request.filters.isEmpty()) {
					if (!subscriber) {
						return false;
					}
					eventData.subscriptions.delete(addressIndex);
				} else if (!subscriber) {
					eventData.subscriptions.set(addressIndex, { link: link, dst: src, filters: request.filters });
				} else {
					subscriber.filters = request.filters;
				}
				break;

			default:
				throw new Error(`unreachable case: ${String(request.action)}`);
		}

		if (eventData.subscriptionUpdate) {
			const eventReplay = await eventData.subscriptionUpdate(request, src, dst);
			if (eventReplay) {
				link.sendTo(src, eventReplay);
				return true;
			}
		}

		return false;
	}
}

export interface SubscribableValue {
	id: number | string,
	updatedAtMs: number,
	isDeleted: boolean,
}

/**
 * Component for subscribing to and tracking updates of a remote resource
 * Multiple handlers can be subscribed at the same time
 */
export class EventSubscriber<E, S = null> {
	/** The time at which an event was last received, is less than 0 when there have been no events */
	lastUpdatedMs = -1;
	/** True if this subscriber is currently synced with the source */
	synced = false;
	/** Repeat calls to getSnapshot will return the same readonly copy unless values has updated */
	private _snapshot: readonly [S, boolean] = [this.makeSnapshot(), false];
	private _snapshotLastUpdatedMs = -1;
	/** Callbacks will be called when an event is received or the synced state changes */
	private _callbacks = new Array<EventSubscriberCallback<E>>();
	/** Filters applied to the filtered handler, if empty the filtered handler will not be called */
	private _filters = SubscriptionFilters.empty();

	constructor(
		protected Event: EventClass<E>,
		public control: Link,
		protected filteredHandler?: EventSubscriberCallback<E>,
	) {
		control.handle(Event, this._handleEvent.bind(this));
		// The events below exist only on websocket connectors, we can't early return because of test mocking
		const webSocketConnector = control.connector as WebSocketBaseConnector;
		webSocketConnector.on("connect", () => {
			this.handleConnectionEvent("connect");
		});
		webSocketConnector.on("close", () => {
			this.handleConnectionEvent("close");
		});
	}

	/**
	 * Handle connection events from this connector or another in the chain to the controller
	 * This should be called by an instance plugin during onControllerConnectionEvent
	 * @param event - event type that occurred
	 */
	handleConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect" || event === "resume") {
			this._sendRequest("replace", this._callbacks.length > 0 ? SubscriptionFilters.all() : this._filters);
		} else if (this.synced) {
			this.synced = false;
			this._notify(null);
		}
	}

	/**
	 * Handle incoming events and distribute it to the correct callbacks
	 * @param event - event from subscribed resource
	 * @internal
	 */
	private async _handleEvent(event: E) {
		const eventTimeMs = this.getLastUpdatedTimeMs(event);
		if (eventTimeMs > this.lastUpdatedMs) {
			this.lastUpdatedMs = eventTimeMs;
		}
		this.synced = this._hasSubscriptions();
		this.processEvent(event);
		this._notify(event);
	}

	private _notify(event: E | null) {
		for (const callback of this._callbacks) {
			callback(event, this.synced);
		}
		if (this.filteredHandler && !this._filters.isEmpty()) {
			this.filteredHandler(event, this.synced);
		}
	}

	protected getLastUpdatedTimeMs(event: E) {
		return Date.now();
	}

	protected processEvent(event: E) {
		// Noop for EventSubscriber
	}

	protected makeSnapshot(): S {
		return null as S;
	}

	/**
	 * Subscribe to receive all event notifications
	 * @param handler -
	 *     callback invoked whenever the subscribed resource changes or the
	 *     synced property changes, in which case the event will be null.
	 * @returns function that will unsubscribe from notifications
	 */
	subscribe(handler: EventSubscriberCallback<E>) {
		this._callbacks.push(handler);
		if (this._callbacks.length === 1) {
			this._sendRequest("subscribe", SubscriptionFilters.all());
		}
		return () => {
			// During a page transition the components currently rendered
			// are unmounted and then the components for the new page is
			// mounted.  This means that if a resource is used by both pages
			// it is first unsubscribed by the unmounted component causing
			// the callbacks count to go to zero and a subscription update
			// to be sent, and then subscribed by the mounted component
			// causing another subscription update to be sent.

			// By delaying the unsubscription here the subscription happens
			// before the unsubscription, thus preventing the redundant
			// updates from being sent out.
			setImmediate(() => {
				let index = this._callbacks.lastIndexOf(handler);
				if (index === -1) {
					return;
				}
				this._callbacks.splice(index, 1);
				if (this._callbacks.length === 0) {
					this._sendRequest("replace", this._filters);
				}
			});
		};
	}

	/** Returns true if all filters are present */
	hasFilters(filters: string | string[] | SubscriptionFilters) {
		if (!(filters instanceof SubscriptionFilters)) {
			filters = SubscriptionFilters.fromShorthand(filters);
		}
		return this._filters.extends(filters);
	}

	/** Add filters to the filtered handler */
	addFilters(filters: string | string[] | SubscriptionFilters) {
		if (!(filters instanceof SubscriptionFilters)) {
			filters = SubscriptionFilters.fromShorthand(filters);
		}
		this._filters.union(filters);
		this._sendRequest("subscribe", filters);
	}

	/** Remove filters from the filtered handler */
	removeFilters(filters: string | string[] | SubscriptionFilters) {
		if (!(filters instanceof SubscriptionFilters)) {
			filters = SubscriptionFilters.fromShorthand(filters);
		}
		this._filters.subtract(filters);
		this._sendRequest("unsubscribe", filters);
	}

	/** Clear all filters from the filtered handler, it will no longer be called */
	clearFilters() {
		this._filters = SubscriptionFilters.empty();
		if (!this._hasSubscriptions()) {
			this._sendRequest("unsubscribe", SubscriptionFilters.all());
		}
	}

	/**
	 * Obtain a snapshot of the current state of the tracked resource
	 * @returns tuple of values map snapshot and synced property.
	 */
	getSnapshot(): readonly [S, boolean] {
		if (this._snapshotLastUpdatedMs !== this.lastUpdatedMs || this._snapshot[1] !== this.synced) {
			this._snapshotLastUpdatedMs = this.lastUpdatedMs;
			this._snapshot = [this.makeSnapshot(), this.synced];
		}
		return this._snapshot;
	}

	/** Returns true if there are any active subscription callbacks */
	private _hasSubscriptions() {
		return this._callbacks.length > 0 || !this._filters.isEmpty();
	}

	/**
	 * Update the subscription with the controller based on current handler counts
	 */
	private async _sendRequest(action: SubscriptionAction, filters: SubscriptionFilters) {
		if (!this.control.connector.valid) {
			return;
		}

		const entry = Link._eventsByClass.get(this.Event)!;
		try {
			const updatesSent = await this.control.sendTo("controller", new SubscriptionRequest(
				entry.name, action, this.lastUpdatedMs, filters
			));
			if (!updatesSent) {
				this.synced = this._hasSubscriptions();
				this._notify(null);
			}
		} catch (err: any) {
			if (!(err instanceof RequestError) || err.code !== "SessionLost") {
				logger.error(`Unexpected error updating ${entry.name} subscription:\n${err.stack}`);
			}
		}
	}
}

export class ValueSubscriber<
	E extends { value: V },
	V extends SubscribableValue = E["value"],
> extends EventSubscriber<E, Readonly<V> | null> {
	/** Current value of the subscribed resource */
	value: V | null = null;

	protected override getLastUpdatedTimeMs(event: E) {
		return event.value.updatedAtMs;
	}

	protected override processEvent(event: E) {
		this.value = event.value;
	}

	protected override makeSnapshot() {
		return this.value;
	}
}

export class MapSubscriber<
	E extends { updates: V[] },
	K extends string | number = E["updates"][number]["id"],
	V extends SubscribableValue = E["updates"][number],
> extends EventSubscriber<E, ReadonlyMap<K, Readonly<V>>> {
	/** Current value of the subscribed resource */
	values = new Map<K, V>();

	protected override getLastUpdatedTimeMs(event: E) {
		let maxTime = this.lastUpdatedMs;
		for (const update of event.updates) {
			if (update.updatedAtMs > maxTime) {
				maxTime = update.updatedAtMs;
			}
		}
		return maxTime;
	}

	protected override processEvent(event: E) {
		for (const value of event.updates) {
			// Warn about updates which changes content but don't update updatedAtMs
			const existing = this.values.get(value.id as K);
			if (existing && existing.updatedAtMs === value.updatedAtMs && !isDeepStrictEqual(existing, value)) {
				logger.warn(
					`${this.Event.name} contains update for value with id ${value.id} that has an identical ` +
					"updatedAtMs timestamp but differing content"
				);
			}
			if (value.isDeleted) {
				this.values.delete(value.id as K);
			} else {
				this.values.set(value.id as K, value);
			}
		}
	}

	protected override makeSnapshot() {
		return new Map(this.values);
	}
}
