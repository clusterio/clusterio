import { Type, Static } from "@sinclair/typebox";
import { Link, Event, EventClass, RequestHandler, WebSocketClientConnector, WebSocketBaseConnector } from "./link";
import { Address, MessageRequest } from "./data";
import { User } from "./users";

export type SubscriptionRequestHandler<T> = RequestHandler<SubscriptionRequest, Event<T> | null>;
export type EventSubscriberCallback<T> = (value: T) => void;

export type ChannelEvent<T> = Event<T> & {
    get subscriptionChannel(): number | string;
}

export type ChannelEventClass<T> = EventClass<T> & {
    new(...args: any): ChannelEvent<T>
}

/**
 * Response received by the subscriber after a request
 * It can contain an eventReplay value if the event sender implements a subscription handler
 * This replay will be send to the handlers as if an update had just occurred
 */
export class SubscriptionResponse {
    constructor(
        public readonly eventReplay: Event<unknown> | null = null,
    ) {
        if (eventReplay && !Link._eventsByClass.has(eventReplay.constructor)) {
            throw new Error(`Unregistered Event class ${eventReplay.constructor.name}`);
        }
    }

    static jsonSchema = Type.Union([
        Type.Tuple([
            Type.String(),
            Type.Unknown(),
        ]),
        Type.Null()
    ])

    toJSON() {
        if (this.eventReplay) {
            const entry = Link._eventsByClass.get(this.eventReplay.constructor)!; 
            return [entry.name, this.eventReplay];
        } else {
            return null;
        }
    }

    static fromJSON(json: Static<typeof SubscriptionResponse.jsonSchema>): SubscriptionResponse {
        if (json) {
            const entry = Link._eventsByName.get(json[0]);
            if (!entry) {
                throw new Error(`Unregistered Event class ${json[0]}`);
            } else {
                return new SubscriptionResponse(entry.eventFromJSON(json[1]));
            }
        } else {
            return new SubscriptionResponse();
        }
    }
}

/**
 * A subscription request sent by a subscriber, this updates what events the subscriber will be sent
 * The permission for this request copies the permission from the event being subscribed to
 * allChannels: false, channels: [] will unsubscribe the subscriber from all notifications
 */
export class SubscriptionRequest {
    declare ["constructor"]: typeof SubscriptionRequest;
	static type = "request" as const;
	static src =  ["control", "instance"] as const;
	static dst = "controller" as const;
    static Response = SubscriptionResponse;
	static permission(user: User, message: MessageRequest) {
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
        public allChannels: boolean,
        public channels: Array<string | number> = [],
        public lastRequestTime: number = 0,
    ) {
        if (!Link._eventsByName.has(eventName)) {
            throw new Error(`Unregistered Event class ${eventName}`);
        }
    }

    static jsonSchema = Type.Tuple([
        Type.String(),
        Type.Boolean(),
        Type.Array(Type.Union([Type.String(), Type.Number()])),
        Type.Number(),
    ])

    toJSON() {
        return [this.eventName, this.allChannels, this.channels, this.lastRequestTime];
    }

    static fromJSON(json: Static<typeof SubscriptionRequest.jsonSchema>): SubscriptionRequest {
        return new this(...json);
    }
}

/**
 * A class component to handle incoming subscription requests and offers a method to broadcast events to subscribers
 * After creation, no other handler can be registered for SubscriptionRequest on the controller
 */
export class SubscriptionController {
    _events = new Map<string, {
        subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
        subscriptions: Map<Link, { all: boolean, channels: Array<string | number> }>,
    }>();

    constructor(
        private controller: any, // Controller | Link
    ) {
        this.controller.handle(SubscriptionRequest, this._handleRequest.bind(this));
    }

    /**
     * Allow clients to subscribe to an event by telling the subscription controller to accept them
     * Has an optional subscription update handler which is called when any client updates their subscription
     */
	handle<T>(Event: EventClass<T>, subscriptionUpdate?: SubscriptionRequestHandler<T>,): void;
    handle(
        Event: EventClass<unknown>,
		subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
    ) {
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
     * Broadcast an event to all subscribers of that event, will be filtered by channel if a ChannelEvent is provided
     */
    broadcast<T>(event: Event<T> | ChannelEvent<T>): void;
    broadcast(event: Event<unknown> | ChannelEvent<unknown>) {
        const entry = Link._eventsByClass.get(event.constructor);
        if (!entry) {
			throw new Error(`Unregistered Event class ${event.constructor.name}`);
		}
        const eventData = this._events.get(entry.name);
        if (!eventData) {
            throw new Error(`Event ${entry.name} is not a registered as subscribable`);
		}
        const channel = "subscriptionChannel" in event ? event.subscriptionChannel : null;
        for (let [link, subscription] of eventData.subscriptions) {
            if ((link.connector as WebSocketBaseConnector).closing) {
                eventData.subscriptions.delete(link);
            } else if ((subscription.all || (channel && subscription.channels.includes(channel)))) {
                link.send(event);
            }
		}
    }

    /**
     * Handle incoming event subscription requests
     */
    async _handleRequest(event: SubscriptionRequest, src: Address, dst: Address) {
        if (!Link._eventsByName.has(event.eventName)) {
            throw new Error(`Event ${event.eventName} is not a registered event`);
		}
        const eventData = this._events.get(event.eventName);
        if (!eventData) {
            throw new Error(`Event ${event.eventName} is not a registered as subscribable`);
		}
        const eventReplay = eventData.subscriptionUpdate ? await eventData.subscriptionUpdate(event, src, dst) : null;
        const link: Link = this.controller.wsServer.controlConnections.get(src.id);
        if (event.allChannels === false && event.channels.length === 0) {
            eventData.subscriptions.delete(link);
        } else {
            if (!eventData.subscriptions.has(link)) {
                link.connector.once("close", () => {
                    eventData.subscriptions.delete(link);
                })
            }
            eventData.subscriptions.set(link, { all: event.allChannels, channels: event.channels });
        }
        return new SubscriptionResponse(eventReplay);
    }
}

/**
 * A class component to allow subscribing and unsubscribing to/from an event and its channels
 * Channels are an optional feature which can be implemented to only get notifications of reliant updates
 * Multiple handlers can be subscribed at the same time, on the same or different channels
 */
export class EventSubscriber<T, V=T> {
    _callbacks = new Array<EventSubscriberCallback<V>>()
    _channelCallbacks = new Map<string | number, Array<EventSubscriberCallback<V>>>()
    lastResponse: Event<T> | null = null;
    lastResponseTime = 0;
    control?: Link

    constructor(
        private event: EventClass<T> | ChannelEventClass<T>,
        private prehandler?: (event: Event<T>) => V,
        control?: Link
    ) {
        const entry = Link._eventsByClass.get(this.event);
		if (!entry) {
			throw new Error(`Unregistered Event class ${this.event.name}`);
		}
        if (control) {
            this.connectControl(control);
        }
    }

    /**
     * Handle incoming events and distribute it to the correct callbacks
     */
    async _handle(response: Event<T> | ChannelEvent<T>) {
        this.lastResponse = response;
        this.lastResponseTime = Date.now();
        const value = this.prehandler ? this.prehandler(response) : response as any;
        for (let callback of this._callbacks) {
            callback(value);
        }
        const channel = "subscriptionChannel" in response ? response.subscriptionChannel : null;
        if (channel) {
            const callbacks = this._channelCallbacks.get(channel);
            if (callbacks) {
                for (let callback of callbacks) {
                    callback(value);
                }
            }
        }
    }

    /**
     * If a control link was not connected at creation, it can be connected here (normally during onControllerConnectionEvent)
     */
    connectControl(control: Link) {
        if (this.control === control) return Promise.resolve();
        this.control = control;
        this.control.handle(this.event, this._handle.bind(this));
        return this._updateSubscription();
    }

    /**
     * Subscribe to receive all event notifications
     */
    subscribe(handler: EventSubscriberCallback<V>) {
        this._callbacks.push(handler);
		return this._updateSubscription();
    }

    /**
     * Subscribe to receive event notifications for the given channel
     */
    subscribeToChannel(channel: string | number, handler: EventSubscriberCallback<V>) {
        if (!this._channelCallbacks.get(channel)) {
            this._channelCallbacks.set(channel, []);
        }
        this._channelCallbacks.get(channel)!.push(handler);
		return this._updateSubscription();
    }

    /**
     * Unsubscribe from receiving all event notifications, does not effect the subscriptions of other handlers
     * Will throw an error if your handler is not subscribed to all channels, does not accept anonymous functions
     */
    unsubscribe(handler: EventSubscriberCallback<V>) {
        let index = this._callbacks.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("handler is not registered");
		}

		this._callbacks.splice(index, 1);
		return this._updateSubscription();
    }

    /**
     * Unsubscribe from receiving event notifications for a given channel, does not effect the subscriptions of other handlers
     * Will throw an error if your handler is not subscribed to the channel, does not accept anonymous functions
     */
    unsubscribeFromChannel(channel: string | number, handler: EventSubscriberCallback<V>) {
        const channelCallbacks = this._channelCallbacks.get(channel);
        if (!channelCallbacks) {
            throw new Error("handler is not registered");
        }

        let index = channelCallbacks.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("handler is not registered");
		}

        if (channelCallbacks.length === 1) {
            this._channelCallbacks.delete(channel);
        } else {
            channelCallbacks.splice(index, 1);
        }
		return this._updateSubscription();
    }

    /**
     * Update the subscription with the controller based on current handler counts
     */
    async _updateSubscription() {
        if (!this.control || !(this.control.connector as WebSocketClientConnector).connected) return;
        const entry = Link._eventsByClass.get(this.event)!;

        const response = await this.control.send(new SubscriptionRequest(
            entry.name,
            this._callbacks.length > 0,
            [...this._channelCallbacks.keys()],
            this.lastResponseTime
        ));

        if (response.eventReplay) {
            await this._handle(response.eventReplay);
        }
    }
}