"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

describe("lib/subscriptions", function() {
	describe("class SubscriptionResponse", function() {
		describe("constructor()", function() {
			it("should be constructable without an event replay", function() {
				assert(false);
			});
			it("should be constructable with an event replay", function() {
				assert(false);
			});
		});

		describe("toJSON()", function() {
			it("should be serialisable to json without an event replay", function() {
				assert(false);
			});
			it("should be serialisable to json with an event replay", function() {
				assert(false);
			});
		});

		describe("fromJSON()", function() {
			it("should be deserialisable from json without an event replay", function() {
				assert(false);
			});
			it("should be deserialisable from json with an event replay", function() {
				assert(false);
			});
		});

		it("should be round trip json serialisable without an event replay", function() {
			assert(false);
		});

		it("should be round trip json serialisable with an event replay", function() {
			assert(false);
		});
	});

	describe("class SubscriptionRequest", function() {
		describe("constructor()", function() {
			it("should be constructable with only an allChannels argument", function() {
				assert(false);
			});
			it("should be constructable with without a lastRequestTime", function() {
				assert(false);
			});
			it("should be constructable with with a lastRequestTime", function() {
				assert(false);
			});
		});

		describe("permission()", function() {
			it("should do nothing when the event has no permission property", function() {
				assert(false);
			});
			it("should check user permission when the permission property is a string", function() {
				assert(false);
			});
			it("should call the permission property when it is a function", function() {
				assert(false);
			});
		});

		it("should be serialisable to json", function() {
			assert(false);
		});

		it("should be deserialisable from json", function() {
			assert(false);
		});

		it("should be round trip json serialisable", function() {
			assert(false);
		});
	});

	describe("class SubscriptionController", function() {
		it("should handle the SubscriptionRequest event", function() {
			assert(false);
		});

		describe("handle()", function() {
			it("should accept registered events", function() {
				assert(false);
			});
			it("should not accept unregistered events", function() {
				assert(false);
			});
			it("should not accept events already handled by the class", function() {
				assert(false);
			});
		});

		describe("broadcast()", function() {
			it("should not accept unregistered events", function() {
				assert(false);
			});
			it("should not accept events not handled by the class", function() {
				assert(false);
			});
			it("should notify all links who subscribed all notifications, when channels are disabled", function() {
				assert(false);
			});
			it("should notify all links who subscribed all notifications, when channels are enabled", function() {
				assert(false);
			});
			it("should not notify a link who unsubscribed from all notifications", function() {
				assert(false);
			});
			it("should notify all links who subscribed the specific channel", function() {
				assert(false);
			});
			it("should not notify a link who did subscribe the specific channel", function() {
				assert(false);
			});
			it("should not notify a link who unsubscribed from the specific channel", function() {
				assert(false);
			});
			it("should not notify links which are closed or closing", function() {
				assert(false);
			});
		});

		describe("_handleEvent()", function() {
			it("should not accept subscriptions to unregistered events", function() {
				assert(false);
			});
			it("should not accept subscriptions to events not handled by the class", function() {
				assert(false);
			});
			it("should accept a subscription to all notifications for an event", function() {
				assert(false);
			});
			it("should accept a unsubscription from all notifications for an event", function() {
				assert(false);
			});
			it("should accept a subscription to a specific channel for an event", function() {
				assert(false);
			});
			it("should accept a unsubscription from a specific channel for an event", function() {
				assert(false);
			});
			it("should accept a respond with an event replay when returned by the handler", function() {
				assert(false);
			});
		});
	});

	describe("class EventSubscriber", function() {
		describe("constructor()", function() {
			it("should not accept unregistered events", function() {
				assert(false);
			});
			it("should handle the provided event if a control link is given", function() {
				assert(false);
			});
			it("should call and use the return of a pre-handler if provided", function() {
				assert(false);
			});
		});

		describe("connectControl()", function() {
			it("should handle the provided event", function() {
				assert(false);
			});
			it("should do nothing if the control is already connected", function() {
				assert(false);
			});
		});

		describe("subscribe()", function() {
			it("should allow subscriptions to an event", function() {
				assert(false);
			});
			it("should call all handlers who subscripted, when channels are disabled", function() {
				assert(false);
			});
			it("should call all handlers who subscripted, when channels are enabled", function() {
				assert(false);
			});
		});

		describe("subscribeToChannel()", function() {
			it("should allow subscriptions to a channel for an event", function() {
				assert(false);
			});
			it("should call all handlers who subscripted to the specific channel", function() {
				assert(false);
			});
			it("should not call a handler who did not subscribe to the specific channel", function() {
				assert(false);
			});
		});

		describe("unsubscribe()", function() {
			it("should allow unsubscribing from an event", function() {
				assert(false);
			});
			it("should throw an error if the handler was not subscribed", function() {
				assert(false);
			});
		});

		describe("unsubscribeFromChannel()", function() {
			it("should allow unsubscribing from a channel for an event", function() {
				assert(false);
			});
			it("should throw an error if the handler was not subscribed", function() {
				assert(false);
			});
		});

		describe("_updateSubscription()", function() {
			it("should correctly request a subscription for all channels", function() {
				assert(false);
			});
			it("should correctly request a subscription for some channels", function() {
				assert(false);
			});
			it("should correctly request a subscription for no channels", function() {
				assert(false);
			});
			it("should call handlers when a replay event is returned", function() {
				assert(false);
			});
		});
	});
});
