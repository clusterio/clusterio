import { Type, Static } from "@sinclair/typebox";
import { Link, Event, EventClass, RequestHandler, WebSocketClientConnector } from "./link";
import { Address, MessageRequest } from "./data";
import { User } from "./users";

export type SubscriptionChannelCategoriser<T> = (event: Event<T>) => string | number;
export type SubscriptionRequestHandler<T> = RequestHandler<SubscriptionRequest, Event<T> | null>;
export type EventSubscriberCallback<T> = (event: Event<T>) => Promise<void>;

/**
 * Response received by the subscriber after a request
 * It can contain an eventReplay value if the event sender implements a subscription handler
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
 * allChannels: false, channels: [] will unsubscribe the subscriber from being sent any events
 */
export class SubscriptionRequest {
    declare ["constructor"]: typeof SubscriptionRequest;
	static type = "request" as const;
	static src =  ["control", "instance"] as const;
	static dst = "controller" as const;
	static plugin = "exp_commands" as const;
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
 * A class component to handle incoming subscription requests and offers a method to broadcast to subscribers
 * After creation, no other handler can be registered for SubscriptionRequest
 */
export class SubscriptionController {
    _events = new Map<string, {
        subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
        channelCategoriser?: SubscriptionChannelCategoriser<unknown>,
        subscriptions: Map<Link, { all: boolean, channels: Array<string | number> }>,
    }>();

    constructor(
        private controller: any, // Controller | Link
    ) {
        this.controller.handle(SubscriptionRequest, this._handleEvent.bind(this));
    }

	handle<T>(Event: EventClass<T>, subscriptionUpdate?: SubscriptionRequestHandler<T>, channelCategoriser?: SubscriptionChannelCategoriser<T>): void;
    handle(
        Event: EventClass<unknown>,
		subscriptionUpdate?: SubscriptionRequestHandler<unknown>,
		channelCategoriser?: SubscriptionChannelCategoriser<unknown>,
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
            channelCategoriser: channelCategoriser,
            subscriptions: new Map(),
        });
    }

    broadcast<T>(event: Event<T>): void;
    broadcast(event: Event<unknown>) {
        const entry = Link._eventsByClass.get(event.constructor);
        if (!entry) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
        const eventData = this._events.get(entry.name);
        if (!eventData) {
            throw new Error(`Event ${entry.name} is not a registered as subscribable`);
		}
        const channel = eventData.channelCategoriser ? eventData.channelCategoriser(event) : null;
        for (let [link, subscription] of eventData.subscriptions.entries()) {
            if (subscription.all || (channel && subscription.channels.includes(channel))) {
                link.send(event);
            }
		}
    }

    async _handleEvent(event: SubscriptionRequest, src: Address, dst: Address) {
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
            return new SubscriptionResponse(eventReplay);
        } else {
            eventData.subscriptions.set(link, { all: event.allChannels, channels: event.channels });
            return new SubscriptionResponse(eventReplay);
        }
    }
}

/**
 * A class component to handle incoming subscription requests and offers a method to broadcast to subscribers
 * After creation, no other handler can be registered for SubscriptionRequest
 */
export class EventSubscriber<T> {
    _callbacks = new Array<EventSubscriberCallback<T>>()
    _channelCallbacks = new Map<string | number, Array<EventSubscriberCallback<T>>>()
    lastResponse?: Event<T> = undefined;
    lastResponseTime = 0;

    constructor(
        private event: EventClass<T>,
        private channelCategoriser?: SubscriptionChannelCategoriser<T>,
        private control?: Link
    ) {
        const entry = Link._eventsByClass.get(this.event);
		if (!entry) {
			throw new Error(`Unregistered Event class ${this.event.name}`);
		}
        if (this.control) {
            this.control.handle(this.event, this._handle.bind(this));
        }
    }

    async _handle(response: Event<T>) {
        this.lastResponse = response;
        this.lastResponseTime = Date.now();
        for (let callback of this._callbacks) {
			callback(response);
		}
    }

    connectControl(control: Link) {
        if (this.control === control) return;
        this.control = control;
        this.control.handle(this.event, this._handle.bind(this));
    }

    subscribeAll(handler: EventSubscriberCallback<T>) {
        this._callbacks.push(handler);
		this._updateSubscription();
    }

    subscribe(channel: string | number, handler: EventSubscriberCallback<T>) {
        if (!this._channelCallbacks.get(channel)) {
            this._channelCallbacks.set(channel, []);
        }
        this._channelCallbacks.get(channel)!.push(handler);
		this._updateSubscription();
    }

    unsubscribeAll(handler: EventSubscriberCallback<T>) {
        let index = this._callbacks.lastIndexOf(handler);
		if (index === -1) {
			throw new Error("handler is not registered");
		}

		this._callbacks.splice(index, 1);
		this._updateSubscription();
    }

    unsubscribe(channel: string | number, handler: EventSubscriberCallback<T>) {
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
		this._updateSubscription();
    }

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
            this._handle(response.eventReplay);
        }
    }
}