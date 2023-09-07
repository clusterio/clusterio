"use strict";
const events = require("events");
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { MockController, MockConnector, MockControl } = require("../mock");

const addr = lib.Address.fromShorthand;

describe("lib/subscriptions", function() {
	class UnregisteredEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission = null;
	}

	class RegisteredEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission = null;
	}
	lib.Link.register(RegisteredEvent);

	class ChannelEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission = null;

		get subscriptionChannel() {
			return "channelOne";
		}
	}
	lib.Link.register(ChannelEvent);

	class StringPermissionEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission = "StringPermission";
	}
	lib.Link.register(StringPermissionEvent);

	class FunctionPermissionEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission(user, message) {
			user.checkPermission("FunctionPermission");
		};
	}
	lib.Link.register(FunctionPermissionEvent);

	class MockUser {
		checkPermission(permission) {
			this.lastPermissionCheck = permission;
		}
	}

	describe("class SubscriptionResponse", function() {
		it("should be round trip json serialisable without an event replay", function() {
			const response = new lib.SubscriptionResponse();
			const json = JSON.stringify(response);
			assert.equal(typeof json, "string");
			const reconstructed = lib.SubscriptionResponse.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, response);
		});

		it("should be round trip json serialisable with an event replay", function() {
			const response = new lib.SubscriptionResponse(new RegisteredEvent());
			const json = JSON.stringify(response);
			assert.equal(typeof json, "string");
			const reconstructed = lib.SubscriptionResponse.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, response);
		});

		it("should be round trip json serialisable with a null event replay", function() {
			const response = new lib.SubscriptionResponse(null);
			const json = JSON.stringify(response);
			assert.equal(typeof json, "string");
			const reconstructed = lib.SubscriptionResponse.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, response);
		});

		it("should be throw when given an unregistered event", function() {
			assert.throws(
				() => new lib.SubscriptionResponse(new UnregisteredEvent()),
				new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
			);
		});
	});

	describe("class SubscriptionRequest", function() {
		describe("permission()", function() {
			it("should do nothing when the event has no permission property", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, new lib.MessageRequest(
					0,
					addr({ controlId: 0 }),
					addr("controller"),
					lib.SubscriptionRequest.name,
					JSON.stringify(request)
				));
				assert.equal(mockUser.lastPermissionCheck, undefined);
			});
			it("should check user permission when the permission property is a string", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, new lib.MessageRequest(
					0,
					addr({ controlId: 0 }),
					addr("controller"),
					lib.SubscriptionRequest.name,
					request.toJSON()
				));
				assert.equal(mockUser.lastPermissionCheck, "StringPermission");
			});
			it("should call the permission property when it is a function", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(FunctionPermissionEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, new lib.MessageRequest(
					0,
					addr({ controlId: 0 }),
					addr("controller"),
					lib.SubscriptionRequest.name,
					request.toJSON()
				));
				assert.equal(mockUser.lastPermissionCheck, "FunctionPermission");
			});
		});

		it("should be round trip json serialisable", function() {
			const request = new lib.SubscriptionRequest(RegisteredEvent.name, true, ["channelOne"], 123);
			const json = JSON.stringify(request);
			assert.equal(typeof json, "string");
			const reconstructed = lib.SubscriptionRequest.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, request);
		});

		it("should be throw when given an unregistered event", function() {
			assert.throws(
				() => new lib.SubscriptionRequest(UnregisteredEvent.name, true),
				new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
			);
		});
	});

	describe("class SubscriptionController", function() {
		let mockController, subscriptions;
		const connectorSetupDate = [{
			id: 0,
			request: new lib.SubscriptionRequest(RegisteredEvent.name, true),
			src: addr({ controlId: 0 }),
			dst: addr("controller"),
		}, {
			id: 1,
			request: new lib.SubscriptionRequest(RegisteredEvent.name, true),
			src: addr({ controlId: 1 }),
			dst: addr("controller"),
		}, {
			id: 2,
			request: new lib.SubscriptionRequest(ChannelEvent.name, true),
			src: addr({ controlId: 2 }),
			dst: addr("controller"),
		}, {
			id: 3,
			request: new lib.SubscriptionRequest(ChannelEvent.name, false, ["channelOne"]),
			src: addr({ controlId: 3 }),
			dst: addr("controller"),
		}, {
			id: 4,
			request: new lib.SubscriptionRequest(ChannelEvent.name, false, ["channelTwo"]),
			src: addr({ controlId: 4 }),
			dst: addr("controller"),
		}];

		function awaitMessages(ids) {
			return Promise.all(ids.map(function(id) {
				const link = mockController.wsServer.controlConnections.get(id);
				return events.once(link.connector, "send");
			}));
		}

		function assertLastEvent(connectorId, Event) {
			const link = mockController.wsServer.controlConnections.get(connectorId);
			const lastMessage = link.connector.sentMessages.at(-1);
			const name = Event.plugin ? `${Event.plugin}:${Event.name}` : Event.name;
			assert.equal(lastMessage.name, name);
		}

		function assertNoEvent(connectorId) {
			const link = mockController.wsServer.controlConnections.get(connectorId);
			assert.equal(link.connector.sentMessages.length, 0);
		}

		beforeEach(function() {
			mockController = new MockController();
			mockController.wsServer = {
				controlConnections: new Map(connectorSetupDate.map(function (connectorData) {
					return [connectorData.id, new lib.Link(new MockConnector(connectorData.src, connectorData.dst))];
				})),
			};
			subscriptions = new lib.SubscriptionController(mockController);
		});

		it("should handle the SubscriptionRequest event", function() {
			assert.equal(mockController.handles.has(lib.SubscriptionRequest), true);
		});

		describe("handle()", function() {
			it("should accept registered events", function() {
				subscriptions.handle(RegisteredEvent);
			});
			it("should not accept unregistered events", function() {
				assert.throws(
					() => subscriptions.handle(UnregisteredEvent),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should not accept events already handled by the class", function() {
				subscriptions.handle(RegisteredEvent);
				assert.throws(
					() => subscriptions.handle(RegisteredEvent),
					new Error(`Event ${RegisteredEvent.name} is already registered`)
				);
			});
		});

		describe("broadcast()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
				subscriptions.handle(ChannelEvent);
				for (let connectorData of connectorSetupDate) {
					subscriptions._handleRequest(connectorData.request, connectorData.src, connectorData.dst);
				}
			});

			it("should not accept unregistered events", function() {
				assert.throws(
					() => subscriptions.broadcast(new UnregisteredEvent()),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should not accept events not handled by the class", function() {
				assert.throws(
					() => subscriptions.broadcast(new StringPermissionEvent()),
					new Error(`Event ${StringPermissionEvent.name} is not a registered as subscribable`)
				);
			});
			it("should notify all links who subscribed to all channels", async function() {
				const messages = awaitMessages([0, 1]);
				subscriptions.broadcast(new RegisteredEvent());
				await messages;
				assertLastEvent(0, RegisteredEvent); // RegisteredEvent: All
				assertLastEvent(1, RegisteredEvent); // RegisteredEvent: All
				assertNoEvent(2); // ChannelEvent: All
				assertNoEvent(3); // ChannelEvent: channelOne
				assertNoEvent(4); // ChannelEvent: channelTwo
			});
			it("should not notify a link who unsubscribed from all all channels", async function() {
				const messages = awaitMessages([1]);
				const connectorData = connectorSetupDate[0];
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				await subscriptions._handleRequest(request, connectorData.src, connectorData.dst);
				mockController.wsServer.controlConnections.get(0).connector.sentMessages.pop(); // Response to request
				subscriptions.broadcast(new RegisteredEvent());
				await messages;
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
				assertNoEvent(2);
				assertNoEvent(3);
				assertNoEvent(4);
			});
			it("should notify all links who subscribed the specific channel", async function() {
				const messages = awaitMessages([2, 3]);
				subscriptions.broadcast(new ChannelEvent());
				await messages;
				assertNoEvent(0);
				assertNoEvent(1);
				assertLastEvent(2, ChannelEvent);
				assertLastEvent(3, ChannelEvent);
				assertNoEvent(4);
			});
			it("should not notify a link who unsubscribed from the specific channel", async function() {
				const messages = awaitMessages([2]);
				const connectorData = connectorSetupDate[3];
				const request = new lib.SubscriptionRequest(ChannelEvent.name, false, []);
				await subscriptions._handleRequest(request, connectorData.src, connectorData.dst);
				mockController.wsServer.controlConnections.get(3).connector.sentMessages.pop(); // Response to request
				subscriptions.broadcast(new ChannelEvent());
				await messages;
				assertNoEvent(0);
				assertNoEvent(1);
				assertLastEvent(2, ChannelEvent);
				assertNoEvent(3);
				assertNoEvent(4);
			});
			it("should not notify links which are closed or closing", async function() {
				const messages = awaitMessages([1]);
				const link = mockController.wsServer.controlConnections.get(0);
				link.connector.closing = true;
				subscriptions.broadcast(new RegisteredEvent());
				await messages;
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
				assertNoEvent(2);
				assertNoEvent(3);
				assertNoEvent(4);
			});
		});

		describe("_handleRequest()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
				subscriptions.handle(ChannelEvent);
			});

			it("should not accept subscriptions to unregistered events", function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = UnregisteredEvent.name;
				const connectorData = connectorSetupDate[0];
				assert.rejects(
					subscriptions._handleRequest(request, connectorData.src, connectorData.dst),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should not accept subscriptions to events not handled by the class", function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = StringPermissionEvent.name;
				const connectorData = connectorSetupDate[0];
				assert.rejects(
					subscriptions._handleRequest(request, connectorData.src, connectorData.dst),
					new Error(`Event ${StringPermissionEvent.eventName} is not a registered as subscribable`)
				);
			});
			it("should accept a subscription to all channels", async function() {
				const messages = awaitMessages([0]);
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions._handleRequest(request, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new RegisteredEvent());
				await messages;
				assertLastEvent(0, RegisteredEvent);
			});
			it("should accept a unsubscription from all channels", async function() {
				const messages = awaitMessages([0]);
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions._handleRequest(request, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new RegisteredEvent());
				await messages;
				assertLastEvent(0, RegisteredEvent);

				const link = mockController.wsServer.controlConnections.get(0);
				link.connector.sentMessages.pop();

				const unsubRequest = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				await subscriptions._handleRequest(unsubRequest, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new RegisteredEvent());
				assertNoEvent(0);
			});
			it("should accept a subscription to a specific channel", async function() {
				const messages = awaitMessages([0]);
				const request = new lib.SubscriptionRequest(ChannelEvent.name, false, ["channelOne"]);
				await subscriptions._handleRequest(request, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new ChannelEvent());
				await messages;
				assertLastEvent(0, ChannelEvent);
			});
			it("should accept a unsubscription from a specific channel", async function() {
				const messages = awaitMessages([0]);
				const request = new lib.SubscriptionRequest(ChannelEvent.name, false, ["channelOne"]);
				await subscriptions._handleRequest(request, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new ChannelEvent());
				await messages;
				assertLastEvent(0, ChannelEvent);

				const link = mockController.wsServer.controlConnections.get(0);
				link.connector.sentMessages.pop();

				const unsubRequest = new lib.SubscriptionRequest(ChannelEvent.name, false, []);
				await subscriptions._handleRequest(unsubRequest, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new ChannelEvent());
				assertNoEvent(0);
			});
			it("should accept a respond with an event replay when returned by the handler", async function() {
				const messages = awaitMessages([0]);
				subscriptions.handle(StringPermissionEvent, undefined, async function() {
					return new StringPermissionEvent();
				});

				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				await subscriptions._handleRequest(request, connectorSetupDate[0].src, connectorSetupDate[0].dst);
				subscriptions.broadcast(new StringPermissionEvent());
				await messages;
				assertLastEvent(0, StringPermissionEvent);

				const link = mockController.wsServer.controlConnections.get(0);
				const lastMessage = link.connector.sentMessages.pop();
				const eventEntry = lib.Link._eventsByClass.get(StringPermissionEvent);
				const response = eventEntry.eventFromJSON(lastMessage.data);
				assert.deepEqual(response, new StringPermissionEvent());
			});
		});
	});

	describe("class EventSubscriber", function() {
		let channelEvent, mockControl, registeredEvent;
		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(
				addr({ controlId: 0 }),
				addr("controller"),
			));
			registeredEvent = new lib.EventSubscriber(RegisteredEvent, undefined, mockControl);
			channelEvent = new lib.EventSubscriber(ChannelEvent, undefined, mockControl);
		});

		function assertLastRequest(request) {
			const Request = request.constructor;
			const lastMessage = mockControl.connector.sentMessages.at(-1);
			const name = Request.plugin ? `${Request.plugin}:${Request.name}` : Request.name;
			assert.equal(lastMessage.name, name);
			assert.deepEqual(lastMessage.data, request);
		}

		describe("constructor()", function() {
			it("should not accept unregistered events", function() {
				assert.throws(
					() => new lib.EventSubscriber(UnregisteredEvent),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should handle the provided event, if a control link is provided", function() {
				assert.equal(mockControl._eventHandlers.has(RegisteredEvent), true);
				assert.equal(mockControl._eventHandlers.has(ChannelEvent), true);
			});
			it("should call and use the return of a pre-handler, if provided", function() {
				let calledWith = null;
				function prehandler() { return "PreHandlerReturn"; }
				const eventSubscriber = new lib.EventSubscriber(StringPermissionEvent, prehandler, mockControl);
				eventSubscriber.subscribe(function(value) { calledWith = value; });
				eventSubscriber._handle(new StringPermissionEvent());
				assert.equal(calledWith, "PreHandlerReturn");
			});
		});

		describe("connectControl()", function() {
			it("should handle the provided event", function() {
				const control = new MockControl(new MockConnector(
					addr({ controlId: 0 }),
					addr("controller"),
				));
				registeredEvent.connectControl(control);
				assert.equal(control._eventHandlers.has(RegisteredEvent), true);
			});
			it("should do nothing if the control is already connected", function() {
				assert.equal(mockControl._eventHandlers.has(RegisteredEvent), true);
				registeredEvent.connectControl(mockControl);
				assert.equal(mockControl._eventHandlers.has(RegisteredEvent), true);
			});
		});

		describe("subscribe()", function() {
			it("should allow subscriptions to an event", function() {
				let calledWith = null;
				let calledWithTwo = null;
				const event = new RegisteredEvent();
				registeredEvent.subscribe(function(value) { calledWith = value; });
				registeredEvent.subscribe(function(value) { calledWithTwo = value; });
				registeredEvent._handle(event);
				assert.deepEqual(calledWith, event);
				assert.deepEqual(calledWithTwo, event);
			});
		});

		describe("subscribeToChannel()", function() {
			it("should allow subscriptions to a channel for an event", function() {
				let calledWith = null;
				let calledWithTwo = null;
				const event = new ChannelEvent();
				channelEvent.subscribeToChannel("channelOne", function(value) { calledWith = value; });
				channelEvent.subscribeToChannel("channelTwo", function(value) { calledWithTwo = value; });
				channelEvent._handle(event);
				assert.deepEqual(calledWith, event);
				assert.deepEqual(calledWithTwo, null);
			});
		});

		describe("unsubscribe()", function() {
			it("should allow unsubscribing from an event", function() {
				let calledWith = null;
				let event = new RegisteredEvent();
				function callback(value) { calledWith = value; }
				registeredEvent.subscribe(callback);
				registeredEvent._handle(event);
				assert.deepEqual(calledWith, event);

				calledWith = null;
				event = new RegisteredEvent();
				registeredEvent.unsubscribe(callback);
				registeredEvent._handle(event);
				assert.equal(calledWith, null);
			});
			it("should throw an error if the handler was not subscribed", function() {
				function callback(value) { calledWith = value; }
				assert.throws(
					() => registeredEvent.unsubscribe(callback),
					new Error("handler is not registered")
				);
			});
		});

		describe("unsubscribeFromChannel()", function() {
			it("should allow unsubscribing from a channel for an event", function() {
				let calledWith = null;
				let event = new ChannelEvent();
				function callback(value) { calledWith = value; }
				channelEvent.subscribeToChannel("channelOne", callback);
				channelEvent._handle(event);
				assert.deepEqual(calledWith, event);

				calledWith = null;
				event = new ChannelEvent();
				channelEvent.unsubscribeFromChannel("channelOne", callback);
				channelEvent._handle(event);
				assert.equal(calledWith, null);
			});
			it("should throw an error if the handler was not subscribed", function() {
				function callback(value) { calledWith = value; }
				assert.throws(
					() => channelEvent.unsubscribeFromChannel("channelOne", callback),
					new Error("handler is not registered")
				);
			});
		});

		describe("_updateSubscription()", function() {
			it("should correctly request a subscription for all channels", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				registeredEvent.subscribe(() => true);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should correctly request a subscription for some channels", async function() {
				const expected = new lib.SubscriptionRequest(ChannelEvent.name, false, ["channelOne"]);
				channelEvent.subscribeToChannel("channelOne", () => true);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should correctly request a subscription for no channels", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				function callback() {}
				registeredEvent.subscribe(callback);
				await events.once(mockControl.connector, "send");
				registeredEvent.unsubscribe(callback);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should call handlers when a replay event is returned", async function() {
				let calledWith = null;
				const event = new RegisteredEvent();
				const message = events.once(mockControl.connector, "send");
				const request = registeredEvent.subscribe(function(value) { calledWith = value; });
				await message;

				const responseMessage = new lib.MessageResponse(
					1,
					mockControl.connector.dst,
					new lib.Address(lib.Address.control, 0, mockControl._nextRequestId - 1),
					new lib.SubscriptionResponse(event).toJSON()
				);
				mockControl.connector.emit("message", responseMessage);
				await request;
				assert.deepEqual(calledWith, event);
			});
		});
	});
});
