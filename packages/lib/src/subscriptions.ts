import { Type, Static } from "@sinclair/typebox";
import { Link, Event, EventClass, RequestHandler, WebSocketClientConnector, WebSocketBaseConnector } from "./link";
import { logger } from "./logging";
import { Address, MessageRequest, IControllerUser } from "./data";

export type SubscriptionRequestHandler<T> = RequestHandler<SubscriptionRequest, Event<T> | null>;
export type EventSubscriberCallback<T> = (value: T) => void;

/**
 * A subscription request sent by a subscriber, this updates what events the subscriber will be sent
 * The permission for this request copies the permission from the event being subscribed to
 * subscribe: false will unsubscribe the subscriber from all notifications
 */
export class SubscriptionRequest {
	declare ["constructor"]: typeof SubscriptionRequest;
	static type = "request" as const;
	static src = ["control", "instance"] as const;
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

	constructor(
		public eventName: string,
		public subscribe: boolean,
		public lastRequestTime: number = 0,
	) {
		if (!Link._eventsByName.has(eventName)) {
			throw new Error(`Unregistered Event class ${eventName}`);
		}
	}

	static jsonSchema = Type.Tuple([
		Type.String(),
		Type.Boolean(),
		Type.Number(),
	]);

	toJSON() {
		return [this.eventName, this.subscribe, this.lastRequestTime];
	}

	static fromJSON(json: Static<typeof SubscriptionRequest.jsonSchema>): SubscriptionRequest {
		return new this(...json);
	}
}

type EventData = {
	subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
	subscriptions: Set<Link>,
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
			subscriptions: new Set(),
		});
	}

	/**
	 * Broadcast an event to all subscribers of that event
	 * @param event - Event to broadcast.
	 */
	broadcast<T>(event: Event<T>) {
		const entry = Link._eventsByClass.get(event.constructor);
		if (!entry) {
			throw new Error(`Unregistered Event class ${event.constructor.name}`);
		}
		const eventData = this._events.get(entry.name);
		if (!eventData) {
			throw new Error(`Event ${entry.name} is not a registered as subscribable`);
		}
		for (let link of eventData.subscriptions) {
			if ((link.connector as WebSocketBaseConnector).closing) {
				eventData.subscriptions.delete(link);
			} else {
				link.send(event);
			}
		}
	}

	/**
	 * Unsubscribe from all events of a given link.
	 * Used when a link is closed to stop all active subscriptions.
	 * @param link - Link to stop sending events to.
	 */
	unsubscribe(link: Link) {
		for (let eventData of this._events.values()) {
			eventData.subscriptions.delete(link);
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
			eventData.subscriptions.delete(link);
		} else {
			eventData.subscriptions.add(link);
			if (eventData.subscriptionUpdate) {
				const eventReplay = await eventData.subscriptionUpdate(event, src, dst);
				if (eventReplay) {
					link.send(eventReplay);
				}
			}
		}
	}
}

/**
 * A class component to allow subscribing and unsubscribing to/from an event
 * Multiple handlers can be subscribed at the same time
 */
export class EventSubscriber<T extends Event<T>, V=T> {
	_callbacks = new Array<EventSubscriberCallback<V>>();
	lastResponse: Event<T> | null = null;
	lastResponseTime = -1;

	constructor(
		private Event: EventClass<T>,
		public control: Link,
		private prehandler?: (e: T) => V,
	) {
		control.handle(Event, this._handle.bind(this));
		control.connector.on("connect", () => {
			this._updateSubscription();
		});
	}

	/**
	 * Handle incoming events and distribute it to the correct callbacks
	 * @param response - event from subscribed resource
	 * @internal
	 */
	async _handle(response: Event<T>) {
		this.lastResponse = response;
		this.lastResponseTime = Date.now();
		const value = this.prehandler ? this.prehandler(response as T) : response as any;
		for (let callback of this._callbacks) {
			callback(value);
		}
	}

	/**
	 * Subscribe to receive all event notifications
	 * @param handler -
	 *     callback invoked whenever the subscribed resource changes.
	 */
	async subscribe(handler: EventSubscriberCallback<V>) {
		this._callbacks.push(handler);
		await this._updateSubscription();
	}

	/**
	 * Unsubscribe from receiving all event notifications, does not effect
	 * the subscriptions of other handlers.
	 *
	 * @param handler - A callback previously passed to {@link subscribe}
	 *
	 * @throws {Error}
	 *     If your handler is not subscribed, does not accept anonymous
	 *     functions
	 */
	async unsubscribe(handler: EventSubscriberCallback<V>) {
		let index = this._callbacks.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("handler is not registered");
		}

		this._callbacks.splice(index, 1);
		await this._updateSubscription();
	}

	/**
	 * Update the subscription with the controller based on current handler counts
	 */
	async _updateSubscription() {
		if (!(this.control.connector as WebSocketClientConnector).connected) {
			return;
		}
		const entry = Link._eventsByClass.get(this.Event)!;

		try {
			await this.control.send(new SubscriptionRequest(
				entry.name,
				this._callbacks.length > 0,
				this.lastResponseTime
			));
		} catch (err: any) {
			logger.error(
				`Unexpected error updating ${entry.name} subscription:\n${err.stack}`
			);
		}
	}
}
