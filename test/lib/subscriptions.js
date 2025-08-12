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

		it("should be round trip json serialisable with a single filter", function() {
			const request = new lib.SubscriptionRequest(RegisteredEvent.name, true, 456, "foo");
			const json = JSON.stringify(request);
			assert.equal(typeof json, "string");
			const reconstructed = lib.SubscriptionRequest.fromJSON(JSON.parse(json));
			assert.deepEqual(reconstructed, request);
		});

		it("should be round trip json serialisable with multiple filters", function() {
			const request = new lib.SubscriptionRequest(RegisteredEvent.name, true, 789, ["foo", "bar"]);
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
			dst: addr({ controlId: 0 }),
			src: addr("controller"),
		}, {
			id: 1,
			request: new lib.SubscriptionRequest(RegisteredEvent.name, true),
			dst: addr({ controlId: 1 }),
			src: addr("controller"),
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
						getLink(connectorData.id), connectorData.request, connectorData.dst, connectorData.src
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
					getLink(connectorData.id), request, connectorData.dst, connectorData.src
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
						getLink(connectorData.id), connectorData.request, connectorData.dst, connectorData.src
					);
				}
			});

			it("should remove an active subscription link", async function() {
				const link = getLink(0);
				subscriptions.unsubscribeLink(link);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(1);
				assertNoEvent(0);
				assertLastEvent(1, RegisteredEvent);
			});
			it("should remove an active subscription address", async function() {
				const link = getLink(0);
				subscriptions.unsubscribeAddress(connectorSetupDate[0].dst);
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

			it("should not accept subscriptions to unregistered events", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = UnregisteredEvent.name;
				await assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Event ${UnregisteredEvent.name} is not a registered event`)
				);
			});
			it("should not accept subscriptions to events not handled by the class", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				request.eventName = StringPermissionEvent.name;
				await assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Event ${StringPermissionEvent.name} is not a registered as subscribable`)
				);
			});
			it("should accept a subscription", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(0);
				assertLastEvent(0, RegisteredEvent);
			});
			it("should accept an unsubscription", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, true);
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);
				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(0);
				assertLastEvent(0, RegisteredEvent);

				const link = getLink(0);
				link.connector.sentMessages.pop();

				const unsubRequest = new lib.SubscriptionRequest(RegisteredEvent.name, false);
				await subscriptions.handleRequest(
					getLink(0), unsubRequest, connectorSetupDate[0].dst, connectorSetupDate[0].src
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
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
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
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);
				await new Promise(resolve => setImmediate(resolve));
				assertNoEvent(0);
			});

			describe("filters()", function() {
				it("should notify only subscribers matching the broadcast filter", async function() {
					const reqFoo = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), reqFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const reqBar = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "bar");
					await subscriptions.handleRequest(
						getLink(1), reqBar, connectorSetupDate[1].dst, connectorSetupDate[1].src
					);

					const before0 = getLink(0).connector.sentMessages.length;
					const before1 = getLink(1).connector.sentMessages.length;

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await onceConnectorSend(0);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 1);
					assert.equal(getLink(1).connector.sentMessages.length, before1);

					subscriptions.broadcast(new RegisteredEvent(), "bar");
					await onceConnectorSend(1);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 1);
					assert.equal(getLink(1).connector.sentMessages.length, before1 + 1);

					const beforeBaz0 = getLink(0).connector.sentMessages.length;
					const beforeBaz1 = getLink(1).connector.sentMessages.length;
					subscriptions.broadcast(new RegisteredEvent(), "baz");
					await new Promise(resolve => setImmediate(resolve));
					assert.equal(getLink(0).connector.sentMessages.length, beforeBaz0);
					assert.equal(getLink(1).connector.sentMessages.length, beforeBaz1);
				});

				it("should notify subscribers with no filters for any broadcast filter", async function() {
					const reqAll = new lib.SubscriptionRequest(RegisteredEvent.name, true);
					await subscriptions.handleRequest(
						getLink(0), reqAll, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const reqBaz = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "baz");
					await subscriptions.handleRequest(
						getLink(1), reqBaz, connectorSetupDate[1].dst, connectorSetupDate[1].src
					);

					const before0 = getLink(0).connector.sentMessages.length;
					const before1 = getLink(1).connector.sentMessages.length;

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await onceConnectorSend(0);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 1);
					assert.equal(getLink(1).connector.sentMessages.length, before1);

					subscriptions.broadcast(new RegisteredEvent(), "baz");
					await Promise.all([onceConnectorSend(0), onceConnectorSend(1)]);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 2);
					assert.equal(getLink(1).connector.sentMessages.length, before1 + 1);
				});

				it("should merge multiple filter subscriptions for the same subscriber", async function() {
					const reqFoo = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "alpha");
					await subscriptions.handleRequest(
						getLink(0), reqFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const reqBar = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "beta");
					await subscriptions.handleRequest(
						getLink(0), reqBar, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					const before0 = getLink(0).connector.sentMessages.length;

					subscriptions.broadcast(new RegisteredEvent(), "alpha");
					await onceConnectorSend(0);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 1);

					subscriptions.broadcast(new RegisteredEvent(), "beta");
					await onceConnectorSend(0);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 2);

					subscriptions.broadcast(new RegisteredEvent(), "gamma");
					await new Promise(resolve => setImmediate(resolve));
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 2);
				});

				it("should reset to all when subscribing with no filters after having filters", async function() {
					const reqFoo = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), reqFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const reqAll = new lib.SubscriptionRequest(RegisteredEvent.name, true);
					await subscriptions.handleRequest(
						getLink(0), reqAll, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					subscriptions.broadcast(new RegisteredEvent(), "baz");
					await onceConnectorSend(0);
				});

				it("should remove only specified filters on unsubscribe with filters", async function() {
					const reqFilters = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, ["foo", "bar"]);
					await subscriptions.handleRequest(
						getLink(0), reqFilters, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					const unsubFoo = new lib.SubscriptionRequest(RegisteredEvent.name, false, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), unsubFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					const before0 = getLink(0).connector.sentMessages.length;

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(resolve => setImmediate(resolve));
					assert.equal(getLink(0).connector.sentMessages.length, before0);

					subscriptions.broadcast(new RegisteredEvent(), "bar");
					await onceConnectorSend(0);
					assert.equal(getLink(0).connector.sentMessages.length, before0 + 1);
				});

				it("should remove entire subscription when last filter is unsubscribed", async function() {
					const reqFoo = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), reqFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					const unsubFoo = new lib.SubscriptionRequest(RegisteredEvent.name, false, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), unsubFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(resolve => setImmediate(resolve));
					assertNoEvent(0);
				});

				// eslint-disable-next-line max-len
				it("should remove entire subscription when unsubscribing any filter from an all-subscription", async function() {
					const reqAll = new lib.SubscriptionRequest(RegisteredEvent.name, true);
					await subscriptions.handleRequest(
						getLink(0), reqAll, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const unsubAny = new lib.SubscriptionRequest(RegisteredEvent.name, false, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), unsubAny, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					subscriptions.broadcast(new RegisteredEvent());
					await new Promise(resolve => setImmediate(resolve));
					assertNoEvent(0);
				});

				it("should match any of multiple broadcast filters", async function() {
					const reqFoo = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "foo");
					await subscriptions.handleRequest(
						getLink(0), reqFoo, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);
					const reqBar = new lib.SubscriptionRequest(RegisteredEvent.name, true, 0, "bar");
					await subscriptions.handleRequest(
						getLink(1), reqBar, connectorSetupDate[1].dst, connectorSetupDate[1].src
					);

					subscriptions.broadcast(new RegisteredEvent(), ["bar", "baz"]);
					await onceConnectorSend(1);
					assertNoEvent(0);
				});
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

		function assertLastMessage(message) {
			const Message = message.constructor;
			const lastMessage = mockControl.connector.sentMessages.at(-1);
			const name = Message.plugin ? `${Message.plugin}:${Message.name}` : Message.name;
			assert.equal(lastMessage.name, name);
			assert.deepEqual(lastMessage.data, message);
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
				const eventUpdate = new RegisteredEvent([item]);
				registeredEvent.subscribe(function(event, synced) { calledWith = [event, synced]; });
				registeredEvent.subscribe(function(event, synced) { calledWithTwo = [event, synced]; });
				await registeredEvent._handleEvent(eventUpdate);
				assert.deepEqual(calledWith, [eventUpdate, true]);
				assert.deepEqual(calledWithTwo, [eventUpdate, true]);
			});
			it("should allow unsubscribing from an event", async function() {
				let called = false;
				let event = new RegisteredEvent();
				function callback() { called = true; }
				const unsubscribe = registeredEvent.subscribe(callback);
				await registeredEvent._handleEvent(event);
				assert.deepEqual(called, true);

				called = false;
				event = new RegisteredEvent();
				unsubscribe();
				// Wait for unsubscribe to happen.
				await new Promise(resolve => setImmediate(resolve));
				await registeredEvent._handleEvent(event);
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
				await registeredEvent._handleEvent(new RegisteredEvent(update1));
				const snap1 = registeredEvent.getSnapshot();
				assert.deepEqual(snap1, [new Map([[1, update1[0]]]), false]);
				await registeredEvent._handleEvent(new RegisteredEvent(update2));
				const snap2 = registeredEvent.getSnapshot();
				assert.deepEqual(snap2, [new Map([[1, update2[0]], [2, update2[1]]]), false]);
				await registeredEvent._handleEvent(new RegisteredEvent(update3));
				const snap3 = registeredEvent.getSnapshot();
				assert.deepEqual(snap3, [new Map([[2, update2[1]]]), false]);
				// validate previous snapshots were not modified
				assert.deepEqual(snap2, [new Map([[1, update2[0]], [2, update2[1]]]), false]);
				assert.deepEqual(snap1, [new Map([[1, update1[0]]]), false]);
				assert.deepEqual(snap0, [new Map(), false]);
			});
		});

		describe("handleConnectionEvent", function() {
			it("should be called on connector connect event", async function() {
				registeredEvent.subscribe(() => {});
				await events.once(mockControl.connector, "send");
				mockControl.connector.sentMessages.pop();

				registeredEvent.control.connector.emit("connect");
				await events.once(mockControl.connector, "send");
				assertLastMessage(new lib.SubscriptionRequest(RegisteredEvent.name, true, -1));
				mockControl.connector.sentMessages.pop();

				registeredEvent.handleConnectionEvent("connect");
				await events.once(mockControl.connector, "send");
				assertLastMessage(new lib.SubscriptionRequest(RegisteredEvent.name, true, -1));
				mockControl.connector.sentMessages.pop();

				registeredEvent.handleConnectionEvent("resume");
				await events.once(mockControl.connector, "send");
				assertLastMessage(new lib.SubscriptionRequest(RegisteredEvent.name, true, -1));
			});
			it("should set synced to false on connection close", async function() {
				registeredEvent.synced = true;
				registeredEvent.control.connector.emit("close");
				assert(!registeredEvent.synced, "synced was not set to false during close event");

				registeredEvent.synced = true;
				registeredEvent.handleConnectionEvent("drop");
				assert(!registeredEvent.synced, "synced was not set to false during drop");

				registeredEvent.synced = true;
				registeredEvent.handleConnectionEvent("close");
				assert(!registeredEvent.synced, "synced was not set to false during close");
			});
			it("should invoke callbacks on connector close", async function() {
				let calledWith;
				registeredEvent.subscribe((values, synced) => { calledWith = [values, synced]; });
				const [msg] = await events.once(mockControl.connector, "send");
				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(false)
				));
				await new Promise(resolve => setImmediate(resolve));
				assert(registeredEvent.synced, "synced was not set to true before close");
				calledWith = undefined;

				registeredEvent.control.connector.emit("close");
				assert(!registeredEvent.synced, "synced was not set to false");
				assert(calledWith !== undefined, "callback not called");
				assert.deepEqual(calledWith, [null, false]);
			});
		});

		describe("_updateSubscription()", function() {
			it("should do nothing if connection is not valid", async function() {
				registeredEvent.control.connector.valid = false;
				registeredEvent.subscribe(() => true);
				await new Promise(resolve => setImmediate(resolve));
				assertNoMessageSent();
			});
			it("should correctly request a subscription", async function() {
				registeredEvent.subscribe(() => true);
				await events.once(mockControl.connector, "send");
				assertLastMessage(new lib.SubscriptionRequest(RegisteredEvent.name, true, -1));
			});
			it("should correctly request an unsubscription", async function() {
				function callback() {}
				const unsubscribe = registeredEvent.subscribe(callback);
				await events.once(mockControl.connector, "send");
				unsubscribe();
				await events.once(mockControl.connector, "send");
				assertLastMessage(new lib.SubscriptionRequest(RegisteredEvent.name, false, -1));
			});
			it("should set synced and invoke callbacks when request is responded to", async function() {
				let calledWith;
				registeredEvent.subscribe((values, synced) => { calledWith = [values, synced]; });
				const [msg] = await events.once(mockControl.connector, "send");
				assert(!registeredEvent.synced, "synced was set before response");
				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(false)
				));
				await new Promise(resolve => setImmediate(resolve));
				assert(calledWith !== undefined, "callback not called");
				assert.deepEqual(calledWith, [null, true]);
				assert(registeredEvent.synced, "synced was not set");
			});
			it("should set synced and invoke callbacks when request is responded to with data", async function() {
				let calledWith;
				registeredEvent.subscribe((values, synced) => { calledWith = [values, synced]; });
				const [msg] = await events.once(mockControl.connector, "send");
				assert(!registeredEvent.synced, "synced was set before response");
				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(true)
				));
				await new Promise(resolve => setImmediate(resolve));

				assert(!registeredEvent.synced, "synced was set before update");
				assert(calledWith === undefined, "callback called before update");
				const eventUpdate = new RegisteredEvent();
				registeredEvent._handleEvent(eventUpdate);

				assert(registeredEvent.synced, "synced was not set");
				assert(calledWith !== undefined, "callback not called");
				assert.deepEqual(calledWith, [eventUpdate, true]);
			});
		});
	});
});
