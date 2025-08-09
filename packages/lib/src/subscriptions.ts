import { Type, Static } from "@sinclair/typebox";
import { Link, Event, EventClass, RequestHandler, WebSocketBaseConnector } from "./link";
import { Address, MessageRequest, IControllerUser, plainJson, JsonBoolean } from "./data";
import isDeepStrictEqual from "./is_deep_strict_equal";
import { RequestError, SessionLost } from "./errors";
import { logger } from "./logging";

export type SubscriptionRequestHandler<T> = RequestHandler<SubscriptionRequest, Event<T> | null>;
export type EventSubscriberCallback<T> = (event: T | null, synced: boolean) => void

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
	static permission(user: IControllerUser, message: MessageRequest) {
		if (typeof message.data === "object" && message.data !== null) {
			const data = message.data as Static<typeof SubscriptionRequest.jsonSchema>;
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

	constructor(
		public eventName: string,
		public subscribe: boolean,
		public lastRequestTimeMs: number = 0,
		public filters: string | string[] | undefined = undefined,
	) {
		if (!Link._eventsByName.has(eventName)) {
			throw new Error(`Unregistered Event class ${eventName}`);
		}
	}

	static jsonSchema = Type.Union([
		Type.Tuple([
			Type.String(),
			Type.Boolean(),
			Type.Number(),
		]),
		Type.Tuple([
			Type.String(),
			Type.Boolean(),
			Type.Number(),
			Type.Union([Type.String(), Type.Array(Type.String())]),
		]),
	]);

	toJSON() {
		if (this.filters !== undefined) {
			return [this.eventName, this.subscribe, this.lastRequestTimeMs, this.filters];
		}
		return [this.eventName, this.subscribe, this.lastRequestTimeMs];
	}

	static fromJSON(json: Static<typeof SubscriptionRequest.jsonSchema>): SubscriptionRequest {
		const [eventName, subscribe, lastRequestTimeMs, filters] = json;
		return new this(eventName, subscribe, lastRequestTimeMs, filters);
	}
}

type Subscriber = {
	link: Link,
	dst: Address,
	/** Optional filters this subscriber is interested in. Undefined means all events */
	filters?: string[],
}

type EventData = {
	subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
	subscriptions: Array<Subscriber>,
};

/**
 * A class component to handle incoming subscription requests and offers a method to broadcast events to subscribers
 * After creation, no other handler can be registered for SubscriptionRequest on the controller
 */
export class SubscriptionController {
	_events = new Map<string, EventData>();

	private static normalizeFilters(value?: string | string[]): string[] | undefined {
		if (value === undefined) {
			return undefined;
		}
		return Array.isArray(value) ? value : [value];
	}

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
			subscriptions: [],
		});
	}

	/**
	 * Broadcast an event to all subscribers of that event
	 * @param event - Event to broadcast.
	 */
	broadcast<T>(event: Event<T>, filter?: string | string[]) {
		const entry = Link._eventsByClass.get(event.constructor);
		if (!entry) {
			throw new Error(`Unregistered Event class ${event.constructor.name}`);
		}
		const eventData = this._events.get(entry.name);
		if (!eventData) {
			throw new Error(`Event ${entry.name} is not a registered as subscribable`);
		}
		const toRemove: Subscriber[] = [];
		const filtersToMatch = SubscriptionController.normalizeFilters(filter);

		for (const subscriber of eventData.subscriptions) {
			if ((subscriber.link.connector as WebSocketBaseConnector).closing) {
				toRemove.push(subscriber);
				continue;
			}

			if (
				filtersToMatch === undefined
				|| subscriber.filters === undefined
				|| subscriber.filters.some(f => filtersToMatch.includes(f))
			) {
				subscriber.link.sendTo(subscriber.dst, event);
			}
		}
		eventData.subscriptions = eventData.subscriptions.filter(subscriber => !toRemove.includes(subscriber));
	}

	/**
	 * Unsubscribe from all events of a given address.
	 * Used when an instance is stopped to stop all active subscriptions.
	 * @param address - Address to stop sending events to.
	 */
	unsubscribeAddress(address: Address) {
		for (let eventData of this._events.values()) {
			eventData.subscriptions = eventData.subscriptions.filter(
				subscriber => !subscriber.dst.addressedTo(address)
			);
		}
	}

	/**
	 * Unsubscribe from all events of a given link.
	 * Used when a link is closed to stop all active subscriptions.
	 * @param link - Link to stop sending events to.
	 */
	unsubscribeLink(link: Link) {
		for (let eventData of this._events.values()) {
			eventData.subscriptions = eventData.subscriptions.filter(
				subscriber => subscriber.link !== link
			);
		}
	}

	/**
	 * Handle incoming subscription requests on a link
	 * @param link - Link message was received on
	 * @param event - incomming event.
	 * @param src - Source address of incomming request.
	 * @param dst - destination address of incomming request.
	 */
	async handleRequest(link: Link, event: SubscriptionRequest, src: Address, dst: Address) {
		if (!Link._eventsByName.has(event.eventName)) {
			throw new Error(`Event ${event.eventName} is not a registered event`);
		}
		const eventData = this._events.get(event.eventName);
		if (!eventData) {
			throw new Error(`Event ${event.eventName} is not a registered as subscribable`);
		}
		if (event.subscribe === false) {
			// Unsubscribe logic
			const subscriber = eventData.subscriptions.find(sub => sub.dst.addressedTo(src));
			if (!subscriber) {
				return false;
			}
			if (event.filters === undefined) {
				// Remove entire subscription for this address
				eventData.subscriptions = eventData.subscriptions.filter(sub => !sub.dst.addressedTo(src));
			} else {
				const filtersToRemove = Array.isArray(event.filters) ? event.filters : [event.filters];
				if (subscriber.filters === undefined) {
					// Was subscribed to all, remove subscription entirely
					eventData.subscriptions = eventData.subscriptions.filter(sub => !sub.dst.addressedTo(src));
				} else {
					subscriber.filters = subscriber.filters.filter(f => !filtersToRemove.includes(f));
					if (subscriber.filters.length === 0) {
						// No filters left, remove subscription
						eventData.subscriptions = eventData.subscriptions.filter(sub => sub !== subscriber);
					}
				}
			}
		} else {
			// Subscribe logic
			let subscriber = eventData.subscriptions.find(sub => sub.dst.addressedTo(src));
			const newFilters = SubscriptionController.normalizeFilters(event.filters);
			if (!subscriber) {
				eventData.subscriptions.push({ link: link, dst: src, filters: newFilters });
			} else if (subscriber.filters === undefined || newFilters === undefined) {
				// Either was already subscribed to all or new request wants all
				subscriber.filters = undefined;
			} else {
				for (const f of newFilters) {
					if (!subscriber.filters.includes(f)) {
						subscriber.filters.push(f);
					}
				}
			}
			if (eventData.subscriptionUpdate) {
				const eventReplay = await eventData.subscriptionUpdate(event, src, dst);
				if (eventReplay) {
					link.sendTo(src, eventReplay);
					return true;
				}
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

export type EventSubscribable<T, V extends SubscribableValue> = Event<T> & Partial<{
	updates: V[],
}>

/**
 * Component for subscribing to and tracking updates of a remote resource
 * Multiple handlers can be subscribed at the same time
 */
export class EventSubscriber<
	T extends EventSubscribable<T, V>,
	K extends string | number = NonNullable<T["updates"]>[number]["id"],
	V extends SubscribableValue = NonNullable<T["updates"]>[number],
> {
	/** The time at which an event was last received, is less than 0 when there have been no events */
	lastResponseTimeMs = -1;
	/** Values of the subscribed resource */
	values = new Map<K, V>();
	/** True if this subscriber is currently synced with the source */
	synced = false;
	/** True if this subscriber is expecting to receive updates from the source */
	_syncing = false;
	/** Repeat calls to getSnapshot will return the same readonly copy unless values has updated */
	_snapshot: readonly [ReadonlyMap<K, Readonly<V>>, boolean] = [new Map<K, V>(), false];
	_snapshotLastUpdatedMs = -1;
	/** Callbacks will be called when an event is received or the synced state changes */
	_callbacks = new Array<EventSubscriberCallback<T>>();

	constructor(
		private Event: EventClass<T>,
		public control: Link,
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
			this._updateSubscription();
		} else if (this.synced) {
			this.synced = false;
			for (let callback of this._callbacks) {
				callback(null, false);
			}
		}
	}

	/**
	 * Handle incoming events and distribute it to the correct callbacks
	 * @param event - event from subscribed resource
	 * @internal
	 */
	async _handleEvent(event: T) {
		// We support the automatic maintaining of a map for events with the updates property
		const updates = event.updates ?? [];
		for (const value of updates) {
			this.lastResponseTimeMs = Math.max(this.lastResponseTimeMs, value.updatedAtMs);
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
		// Event handling logic
		if (this._syncing && !this.synced) {
			this._snapshotLastUpdatedMs = -1;
			this.synced = true;
		}
		for (const callback of this._callbacks) {
			callback(event, this.synced);
		}
	}

	/**
	 * Subscribe to receive all event notifications
	 * @param handler -
	 *     callback invoked whenever the subscribed resource changes or the
	 *     synced property changes, in which case the event will be null.
	 * @returns function that will unsubscribe from notifications
	 */
	subscribe(handler: EventSubscriberCallback<T>) {
		this._callbacks.push(handler);
		if (this._callbacks.length === 1) {
			this._updateSubscription();
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
					this._updateSubscription();
				}
			});
		};
	}

	/**
	 * Obtain a snapshot of the current state of the tracked resource
	 * @returns tuple of values map snapshot and synced property.
	 */
	getSnapshot() {
		if (this._snapshotLastUpdatedMs !== this.lastResponseTimeMs) {
			this._snapshotLastUpdatedMs = this.lastResponseTimeMs;
			this._snapshot = [new Map(this.values), this.synced];
		}
		return this._snapshot!;
	}

	/**
	 * Update the subscription with the controller based on current handler counts
	 */
	async _updateSubscription() {
		if (!this.control.connector.valid) {
			return;
		}
		const entry = Link._eventsByClass.get(this.Event)!;

		try {
			this._syncing = this._callbacks.length > 0;
			const updatesSent = await this.control.sendTo("controller", new SubscriptionRequest(
				entry.name,
				this._syncing,
				this.lastResponseTimeMs
			));
			if (!updatesSent) {
				this.synced = this._syncing;
				for (const callback of this._callbacks) {
					callback(null, this.synced);
				}
			}
		} catch (err: any) {
			if (!(err instanceof RequestError) || err.code !== "SessionLost") {
				logger.error(
					`Unexpected error updating ${entry.name} subscription:\n${err.stack}`
				);
			}
		}
	}
}
