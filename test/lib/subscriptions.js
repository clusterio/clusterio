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

	describe("class SubscriptionRequest", function() {
		describe("permission()", function() {
			function newSubscriptionRequestMessage(request) {
				return new lib.MessageRequest(
					0,
					addr({ controlId: 0 }),
					addr("controller"),
					lib.SubscriptionRequest.name,
					request.toJSON()
				);
			}
			it("should do nothing when the event has no permission property", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, undefined);
			});
			it("should check user permission when the permission property is a string", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, "StringPermission");
			});
			it("should call the permission property when it is a function", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(FunctionPermissionEvent.name, true);
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, "FunctionPermission");
			});
		});

		it("should be round trip json serialisable", function() {
			const request = new lib.SubscriptionRequest(RegisteredEvent.name, true, 123);
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
		}];

		function getLink(id) {
			return mockController.wsServer.controlConnections.get(id);
		}
		function onceConnectorSend(id) {
			return events.once(getLink(id).connector, "send");
		}

		function assertLastEvent(connectorId, Event) {
			const link = getLink(connectorId);
			const lastMessage = link.connector.sentMessages.at(-1);
			const name = Event.plugin ? `${Event.plugin}:${Event.name}` : Event.name;
			assert.equal(lastMessage.name, name);
		}

		function assertNoEvent(connectorId) {
			const link = getLink(connectorId);
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
				for (let connectorData of connectorSetupDate) {
					subscriptions.handleRequest(
						getLink(connectorData.id), connectorData.request, connectorData.src, connectorData.dst
					);
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
			it("should notify all links who subscribed", async function() {
				subscriptions.broadcast(new RegisteredEvent());
				await Promise.all([onceConnectorSend(0), onceConnectorSend(1)]);
				assertLastEvent(0, RegisteredEvent); // RegisteredEvent: All
				assertLastEvent(1, RegisteredEvent); // RegisteredEvent: All
			});
			it("should not notify a link who unsubscribed", async function() {
				const connectorData = connectorSetupDate[0];
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				await subscriptions.handleRequest(
					getLink(connectorData.id), request, connectorData.src, connectorData.dst,
				);
				getLink(0).connector.sentMessages.pop(); // Response to request
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(1);
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
			});
			it("should not notify links which are closed or closing", async function() {
				const link = getLink(0);
				link.connector.closing = true;
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(1);
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
			});
		});

		describe("unsubscribe()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
				for (let connectorData of connectorSetupDate) {
					subscriptions.handleRequest(
						getLink(connectorData.id), connectorData.request, connectorData.src, connectorData.dst
					);
				}
			});

			it("should remove an active subscription", async function() {
				const link = getLink(0);
				subscriptions.unsubscribe(link);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(1);
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
			});
		});

		describe("handleRequest()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
			});

			it("should not accept subscriptions to unregistered events", function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = UnregisteredEvent.name;
				assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should not accept subscriptions to events not handled by the class", function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = StringPermissionEvent.name;
				assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Event ${StringPermissionEvent.eventName} is not a registered as subscribable`)
				);
			});
			it("should accept a subscription", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(0);
				assertLastEvent(0, RegisteredEvent);
			});
			it("should accept a unsubscription", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(0);
				assertLastEvent(0, RegisteredEvent);

				const link = getLink(0);
				link.connector.sentMessages.pop();

				const unsubRequest = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				await subscriptions.handleRequest(
					getLink(0), unsubRequest, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				subscriptions.broadcast(new RegisteredEvent());
				assertNoEvent(0);
			});
			it("should accept a respond with an event replay when returned by the handler", async function() {
				subscriptions.handle(StringPermissionEvent, undefined, async function() {
					return new StringPermissionEvent();
				});

				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				subscriptions.broadcast(new StringPermissionEvent());
				await onceConnectorSend(0);
				assertLastEvent(0, StringPermissionEvent);

				const link = getLink(0);
				const lastMessage = link.connector.sentMessages.pop();
				const eventEntry = lib.Link._eventsByClass.get(StringPermissionEvent);
				const response = eventEntry.eventFromJSON(lastMessage.data);
				assert.deepEqual(response, new StringPermissionEvent());
			});
		});
	});

	describe("class EventSubscriber", function() {
		let mockControl, registeredEvent;
		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(
				addr({ controlId: 0 }),
				addr("controller"),
			));
			registeredEvent = new lib.EventSubscriber(RegisteredEvent, mockControl);
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
					() => new lib.EventSubscriber(UnregisteredEvent, mockControl),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
			it("should handle the provided event", function() {
				assert.equal(mockControl._eventHandlers.has(RegisteredEvent), true);
			});
			it("should call and use the return of a pre-handler, if provided", function() {
				let calledWith = null;
				function prehandler() { return "PreHandlerReturn"; }
				const eventSubscriber = new lib.EventSubscriber(StringPermissionEvent, mockControl, prehandler);
				eventSubscriber.subscribe(function(value) { calledWith = value; });
				eventSubscriber._handle(new StringPermissionEvent());
				assert.equal(calledWith, "PreHandlerReturn");
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
				assert.rejects(
					() => registeredEvent.unsubscribe(callback),
					new Error("handler is not registered")
				);
			});
		});

		describe("_updateSubscription()", function() {
			it("should correctly request a subscription", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, true, -1);
				registeredEvent.subscribe(() => true);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should correctly request no subscriptions", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, false, -1);
				function callback() {}
				registeredEvent.subscribe(callback);
				await events.once(mockControl.connector, "send");
				registeredEvent.unsubscribe(callback);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
		});
	});
});
