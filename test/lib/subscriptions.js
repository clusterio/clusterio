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
		constructor(updates = []) {
			this.updates = updates;
		}
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

		it("should throw when given an unregistered event", function() {
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
			it("should accept an unsubscription", async function() {
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
			it("should accept a response with an event replay when returned by the handler", async function() {
				subscriptions.handle(StringPermissionEvent, async function() {
					return new StringPermissionEvent();
				});

				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				await onceConnectorSend(0);
				assertLastEvent(0, StringPermissionEvent);

				const link = getLink(0);
				const lastMessage = link.connector.sentMessages.pop();
				const eventEntry = lib.Link._eventsByClass.get(StringPermissionEvent);
				const response = eventEntry.eventFromJSON(lastMessage.data);
				assert.deepEqual(response, new StringPermissionEvent());
			});
			it("should accept a response with null when returned by the handler", async function() {
				subscriptions.handle(StringPermissionEvent, async function() {
					return null;
				});

				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].src, connectorSetupDate[0].dst
				);
				await new Promise(resolve => setImmediate(resolve));
				assertNoEvent(0);
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

		function assertNoMessageSent() {
			assert.equal(mockControl.connector.sentMessages.length, 0, "messages were sent");
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
		});

		describe("subscribe()", function() {
			it("should allow subscriptions to an event", async function() {
				let calledWith = null;
				let calledWithTwo = null;
				const item = { id: 1, updatedAtMs: 1, isDeleted: false };
				const event = new RegisteredEvent([item]);
				registeredEvent.subscribe(function(updates, synced) { calledWith = [updates, synced]; });
				registeredEvent.subscribe(function(updates, synced) { calledWithTwo = [updates, synced]; });
				await registeredEvent._handle(event);
				assert.deepEqual(calledWith, [[item], false]);
				assert.deepEqual(calledWithTwo, [[item], false]);
			});
			it("should allow unsubscribing from an event", async function() {
				let called = false;
				let event = new RegisteredEvent();
				function callback() { called = true; }
				const unsubscribe = registeredEvent.subscribe(callback);
				await registeredEvent._handle(event);
				assert.deepEqual(called, true);

				called = false;
				event = new RegisteredEvent();
				unsubscribe();
				// Wait for unsubscribe to happen.
				await new Promise(resolve => setImmediate(resolve));
				await registeredEvent._handle(event);
				assert.equal(called, false);
			});
			it("should not throw error on incorrectly unsubscribing multiple times", async function() {
				const unsubscribe = registeredEvent.subscribe(() => {});
				unsubscribe();
				unsubscribe();
				// Wait for unsubscribe to happen.
				await new Promise(resolve => setImmediate(resolve));
			});
		});

		describe("getSnapshot()", function() {
			it("should give an immutable copy of the tracked values", async function() {
				const update1 = [{ id: 1, updatedAtMs: 1, isDeleted: false }];
				const update2 = [
					{ id: 1, updatedAtMs: 2, isDeleted: false },
					{ id: 2, updatedAtMs: 3, isDeleted: false },
				];
				const update3 = [{ id: 1, updatedAtMs: 4, isDeleted: true }];
				const snap0 = registeredEvent.getSnapshot();
				assert.deepEqual(snap0, [new Map(), false]);
				await registeredEvent._handle(new RegisteredEvent(update1));
				const snap1 = registeredEvent.getSnapshot();
				assert.deepEqual(snap1, [new Map([[1, update1[0]]]), false]);
				await registeredEvent._handle(new RegisteredEvent(update2));
				const snap2 = registeredEvent.getSnapshot();
				assert.deepEqual(snap2, [new Map([[1, update2[0]], [2, update2[1]]]), false]);
				await registeredEvent._handle(new RegisteredEvent(update3));
				const snap3 = registeredEvent.getSnapshot();
				assert.deepEqual(snap3, [new Map([[2, update2[1]]]), false]);
				// validate previous snapshots were not modified
				assert.deepEqual(snap2, [new Map([[1, update2[0]], [2, update2[1]]]), false]);
				assert.deepEqual(snap1, [new Map([[1, update1[0]]]), false]);
				assert.deepEqual(snap0, [new Map(), false]);
			});
		});

		describe("_updateSubscription()", function() {
			it("should do nothing if not connected", async function() {
				registeredEvent.control.connector.connected = false;
				registeredEvent.subscribe(() => true);
				await new Promise(resolve => setImmediate(resolve));
				assertNoMessageSent();
			});
			it("should correctly request a subscription", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, true, -1);
				registeredEvent.subscribe(() => true);
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should correctly request no subscriptions", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, false, -1);
				function callback() {}
				const unsubscribe = registeredEvent.subscribe(callback);
				await events.once(mockControl.connector, "send");
				unsubscribe();
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should set synced and invoke callbacks when request is responded to", async function() {
				let calledWith;
				registeredEvent.subscribe((values, synced) => { calledWith = [values, synced]; });
				const [msg] = await events.once(mockControl.connector, "send");
				assert(!registeredEvent.synced, "synced was set before response");
				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src));
				await new Promise(resolve => setImmediate(resolve));
				assert(calledWith !== undefined, "callback not called");
				assert.deepEqual(calledWith, [[], true]);
				assert(registeredEvent.synced, "synced was not set");
			});
			it("should be called on connector connect event", async function() {
				const expected = new lib.SubscriptionRequest(RegisteredEvent.name, true, -1);
				registeredEvent._callbacks.push(() => {});
				registeredEvent.control.connector.emit("connect");
				await events.once(mockControl.connector, "send");
				assertLastRequest(expected);
			});
			it("should revert synced and invoke callbacks on connector close event", async function() {
				let calledWith;
				registeredEvent.subscribe((values, synced) => { calledWith = [values, synced]; });
				const [msg] = await events.once(mockControl.connector, "send");
				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src));
				await new Promise(resolve => setImmediate(resolve));

				assert(registeredEvent.synced, "synced was not set before close");
				calledWith = undefined;
				registeredEvent.control.connector.emit("close");
				assert(calledWith !== undefined, "callback not called");
				assert.deepEqual(calledWith, [[], false]);
				assert(!registeredEvent.synced, "synced was not reset");
			});
		});
	});
});
