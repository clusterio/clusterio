"use strict";
const events = require("events");
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { MockController, MockConnector, MockControl } = require("../mock");
const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

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

		get filters() {
			return "Filters";
		}
	}
	if (!lib.Link._eventsByName.has(RegisteredEvent.name)) {
		lib.Link.register(RegisteredEvent);
	}

	class StringPermissionEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission = "StringPermission";
	}
	if (!lib.Link._eventsByName.has(StringPermissionEvent.name)) {
		lib.Link.register(StringPermissionEvent);
	}

	class FunctionPermissionEvent {
		static type = "event";
		static src = ["controller", "control"];
		static dst = ["controller", "control"];
		static permission(user, message) {
			user.checkPermission("FunctionPermission");
		};
	}
	if (!lib.Link._eventsByName.has(FunctionPermissionEvent.name)) {
		lib.Link.register(FunctionPermissionEvent);
	}

	class MockUser {
		checkPermission(permission) {
			this.lastPermissionCheck = permission;
		}
	}

	describe("class SubscriptionFilters", function() {
		it("should be round trip serialisable", function() {
			const f = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
			const reconstructed = lib.SubscriptionFilters.fromJSON(JSON.parse(JSON.stringify(f)));
			assert.deepEqual(new Set(reconstructed.toJSON()), new Set(["foo", "bar"]));
		});

		it("should not preserve 'all' through JSON", function() {
			// This is because we use 'undefined' to indicate all
			const f = lib.SubscriptionFilters.all();
			const reconstructed = lib.SubscriptionFilters.fromJSON(JSON.parse(JSON.stringify(f)));
			assert.equal(reconstructed.isAll(), false);
			assert.equal(reconstructed.isEmpty(), true);
		});

		describe("construction", function() {
			it("should create an 'all' filter", function() {
				const f = lib.SubscriptionFilters.all();
				assert.equal(f.isAll(), true);
				assert.equal(f.isEmpty(), false);
			});

			it("should create an 'empty' filter", function() {
				const f = lib.SubscriptionFilters.empty();
				assert.equal(f.isAll(), false);
				assert.equal(f.isEmpty(), true);
			});

			it("should create from shorthand undefined as all", function() {
				const f = lib.SubscriptionFilters.fromShorthand(undefined);
				assert.equal(f.isAll(), true);
			});

			it("should create from shorthand string", function() {
				const f = lib.SubscriptionFilters.fromShorthand("foo");
				assert.equal(f.isAll(), false);
				assert.deepEqual(new Set(f.toJSON()), new Set(["foo"]));
			});

			it("should create from shorthand array", function() {
				const f = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				assert.deepEqual(new Set(f.toJSON()), new Set(["foo", "bar"]));
			});
		});

		describe(".toString()", function() {
			it("should return 'All' for all filters", function() {
				const filters = lib.SubscriptionFilters.all();
				assert.equal(filters.toString(), "[SubscriptionFilters All]");
			});

			it("should return empty set representation for empty filters", function() {
				const filters = lib.SubscriptionFilters.empty();
				assert.equal(filters.toString(), "[SubscriptionFilters Empty]");
			});

			it("should include single filter value", function() {
				const filters = lib.SubscriptionFilters.fromShorthand("foo");
				assert.equal(filters.toString(), "[SubscriptionFilters Set<1>]");
			});

			it("should include multiple filter values", function() {
				const filters = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				assert.equal(filters.toString(), "[SubscriptionFilters Set<2>]");
			});
		});

		describe(".accepts()", function() {
			it("should accept any value when all", function() {
				const f = lib.SubscriptionFilters.all();
				assert.equal(f.accepts("foo"), true);
				assert.equal(f.accepts("bar"), true);
			});

			it("should reject all values when empty", function() {
				const f = lib.SubscriptionFilters.empty();
				assert.equal(f.accepts("foo"), false);
				assert.equal(f.accepts("bar"), false);
			});

			it("should match exact values", function() {
				const f = lib.SubscriptionFilters.fromShorthand(["foo"]);
				assert.equal(f.accepts("foo"), true);
				assert.equal(f.accepts("bar"), false);
			});
		});

		describe(".extends()", function() {
			it("all should extend any filter", function() {
				const all = lib.SubscriptionFilters.all();
				const foo = lib.SubscriptionFilters.fromShorthand("foo");
				assert.equal(all.extends(foo), true);
			});

			it("should return true when superset", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				const b = lib.SubscriptionFilters.fromShorthand(["foo"]);
				assert.equal(a.extends(b), true);
			});

			it("should return false when not superset", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const b = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				assert.equal(a.extends(b), false);
			});
		});

		describe(".intersects()", function() {
			it("should intersect when sharing values", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const b = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				assert.equal(a.intersects(b), true);
				assert.equal(b.intersects(a), true);
			});

			it("should not intersect when disjoint", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const b = lib.SubscriptionFilters.fromShorthand(["bar"]);
				assert.equal(a.intersects(b), false);
				assert.equal(b.intersects(a), false);
			});

			it("all should intersect non-empty", function() {
				const all = lib.SubscriptionFilters.all();
				const foo = lib.SubscriptionFilters.fromShorthand("foo");
				assert.equal(all.intersects(foo), true);
				assert.equal(foo.intersects(all), true);
			});

			it("all should not intersect empty", function() {
				const all = lib.SubscriptionFilters.all();
				const empty = lib.SubscriptionFilters.empty();
				assert.equal(all.intersects(empty), false);
				assert.equal(empty.intersects(all), false);
			});
		});

		describe(".union()", function() {
			it("should merge filters", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const b = lib.SubscriptionFilters.fromShorthand(["bar"]);
				a.union(b);
				assert.deepEqual(new Set(a.toJSON()), new Set(["foo", "bar"]));
			});

			it("should become all if union with all", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const all = lib.SubscriptionFilters.all();
				a.union(all);
				assert.equal(a.isAll(), true);
			});

			it("should remain all if already all", function() {
				const a = lib.SubscriptionFilters.all();
				const b = lib.SubscriptionFilters.fromShorthand(["foo"]);
				a.union(b);
				assert.equal(a.isAll(), true);
			});
		});

		describe(".subtract()", function() {
			it("should remove matching filters", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo", "bar"]);
				const b = lib.SubscriptionFilters.fromShorthand("foo");
				a.subtract(b);
				assert.deepEqual(new Set(a.toJSON()), new Set(["bar"]));
			});

			it("should become empty when subtracting all", function() {
				const a = lib.SubscriptionFilters.fromShorthand(["foo"]);
				const all = lib.SubscriptionFilters.all();
				a.subtract(all);
				assert.equal(a.isEmpty(), true);

				const b = lib.SubscriptionFilters.all();
				b.subtract(all);
				assert.equal(b.isEmpty(), true);
			});

			it("should do nothing when subtracting from all", function() {
				const a = lib.SubscriptionFilters.all();
				const b = lib.SubscriptionFilters.fromShorthand("foo");
				a.subtract(b);
				assert.equal(a.isAll(), true);
			});
		});
	});

	describe("class SubscriptionRequest", function() {
		it("should be round trip json serialisable", function() {
			testRoundTripJsonSerialisable(lib.SubscriptionRequest, testMatrix(
				[RegisteredEvent.name],
				["subscribe", "unsubscribe", "replace"],
				[0, 123],
				[
					undefined,
					lib.SubscriptionFilters.all(),
					lib.SubscriptionFilters.empty(),
					lib.SubscriptionFilters.fromShorthand("foo"),
					lib.SubscriptionFilters.fromShorthand(["foo", "bar"]),
				]
			));
		});

		it("should throw when constructed via fromJSON with unregistered event", function() {
			assert.throws(
				() => lib.SubscriptionRequest.fromJSON([UnregisteredEvent.name,, "subscribe", 0]),
				new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
			);
		});

		describe("static permission()", function() {
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
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, undefined);
			});

			it("should check user permission when the permission property is a string", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, "subscribe");
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, "StringPermission");
			});

			it("should call the permission property when it is a function", function() {
				const mockUser = new MockUser();
				const request = new lib.SubscriptionRequest(FunctionPermissionEvent.name, "subscribe");
				lib.SubscriptionRequest.permission(mockUser, newSubscriptionRequestMessage(request));
				assert.equal(mockUser.lastPermissionCheck, "FunctionPermission");
			});
		});

		describe("construction", function() {
			describe("compatibility 'action'", function() {
				it("should map true to subscribe", function() {
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, true);
					assert.equal(req.action, "subscribe");
				});

				it("should map false to unsubscribe", function() {
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, false);
					assert.equal(req.action, "unsubscribe");
				});
			});

			describe("compatibility 'filters'", function() {
				it("should convert string filters to SubscriptionFilters", function() {
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					assert(req.filters instanceof lib.SubscriptionFilters);
					assert.equal(req.filters.accepts("foo"), true);
				});

				it("should convert array filters to SubscriptionFilters", function() {
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, ["foo", "bar"]);
					assert.equal(req.filters.accepts("foo"), true);
					assert.equal(req.filters.accepts("bar"), true);
				});

				it("should default to 'all' when filters undefined", function() {
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0);
					assert.equal(req.filters.isAll(), true);
				});

				it("should accept SubscriptionFilters directly", function() {
					const filters = lib.SubscriptionFilters.fromShorthand("foo");
					const req = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, filters);
					assert.equal(req.filters, filters);
				});
			});

			it("should throw when given an unregistered event", function() {
				assert.throws(
					() => new lib.SubscriptionRequest(UnregisteredEvent.name, "subscribe"),
					new Error(`Unregistered Event class ${UnregisteredEvent.name}`)
				);
			});
		});
	});

	describe("class SubscriptionController", function() {
		let mockController, subscriptions;

		const connectorSetupDate = [{
			id: 0,
			dst: addr({ controlId: 0 }),
			src: addr("controller"),
		}, {
			id: 1,
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
			assert.deepEqual(link.connector.sentMessages, []);
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

		describe(".handle()", function() {
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

		describe(".broadcast()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
				for (let connectorData of connectorSetupDate) {
					const link = getLink(connectorData.id);
					const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
					subscriptions.handleRequest(link, request, connectorData.dst, connectorData.src);
					link.connector.sentMessages.pop();
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

			it("should respect filters of subscribers", async function() {
				const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "foo");
				await subscriptions.handleRequest(
					getLink(0), request0, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);

				const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "bar");
				await subscriptions.handleRequest(
					getLink(1), request1, connectorSetupDate[1].dst, connectorSetupDate[1].src
				);

				subscriptions.broadcast(new RegisteredEvent(), "foo");
				await onceConnectorSend(0);
				assertNoEvent(1);
				getLink(0).connector.sentMessages.pop();

				subscriptions.broadcast(new RegisteredEvent(), ["bar", "baz"]);
				await onceConnectorSend(1);
				assertNoEvent(0);
			});

			it("should always notify subscribers without filters", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "replace");
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);

				subscriptions.broadcast(new RegisteredEvent(), "foo");
				await onceConnectorSend(0);
				assertLastEvent(0, RegisteredEvent);
			});

			it("should use event filters property if present", async function() {
				const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "Filters");
				await subscriptions.handleRequest(
					getLink(0), request0, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);

				const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "bar");
				await subscriptions.handleRequest(
					getLink(1), request1, connectorSetupDate[1].dst, connectorSetupDate[1].src
				);

				subscriptions.broadcast(new RegisteredEvent());
				await onceConnectorSend(0);
				assertNoEvent(1);
			});

			it("should not notify a link who unsubscribed", async function() {
				const connectorData = connectorSetupDate[0];
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "unsubscribe");
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

		describe(".unsubscribeLink() / .unsubscribeAddress()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
				for (let connectorData of connectorSetupDate) {
					const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
					subscriptions.handleRequest(
						getLink(connectorData.id), request, connectorData.dst, connectorData.src
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

		describe(".handleRequest()", function() {
			beforeEach(function() {
				subscriptions.handle(RegisteredEvent);
			});

			it("should not accept subscriptions to unregistered events", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
				request.eventName = UnregisteredEvent.name;
				await assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Event ${UnregisteredEvent.name} is not a registered event`)
				);
			});

			it("should not accept subscriptions to events not handled by the class", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
				request.eventName = StringPermissionEvent.name;
				await assert.rejects(
					subscriptions.handleRequest(getLink(0), request, addr({ controlId: 0 }), addr("controller")),
					new Error(`Event ${StringPermissionEvent.name} is not a registered as subscribable`)
				);
			});

			it("should accept a response with an event replay when returned by the handler", async function() {
				subscriptions.handle(StringPermissionEvent, async function() {
					return new StringPermissionEvent();
				});

				const link = getLink(0);
				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, "subscribe");
				await subscriptions.handleRequest(
					link, request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);
				await onceConnectorSend(0);
				assertLastEvent(0, StringPermissionEvent);

				const lastMessage = link.connector.sentMessages.pop();
				const eventEntry = lib.Link._eventsByClass.get(StringPermissionEvent);
				const response = eventEntry.eventFromJSON(lastMessage.data);
				assert.deepEqual(response, new StringPermissionEvent());
			});

			it("should accept a response with null when returned by the handler", async function() {
				subscriptions.handle(StringPermissionEvent, async function() {
					return null;
				});

				const request = new lib.SubscriptionRequest(StringPermissionEvent.name, "subscribe");
				await subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				);
				await new Promise(r => setImmediate(r));
				assertNoEvent(0);
			});

			it("should throw if action is not supported", async function() {
				const request = new lib.SubscriptionRequest(RegisteredEvent.name, "invalid action");
				await assert.rejects(subscriptions.handleRequest(
					getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
				), /unreachable case: invalid action/);
			});

			describe("subscribe", function() {
				it("should create a new subscription", async function() {
					const request = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
					await subscriptions.handleRequest(
						getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					subscriptions.broadcast(new RegisteredEvent());
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});

				it("should union filters for existing subscriber", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "bar");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
					link.connector.sentMessages.pop();

					subscriptions.broadcast(new RegisteredEvent(), "bar");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
					link.connector.sentMessages.pop();

					subscriptions.broadcast(new RegisteredEvent(), "baz");
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);
				});

				it("should union filters with all when not specified", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "baz");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});
			});

			describe("unsubscribe", function() {
				it("should remove a subscription", async function() {
					const request = new lib.SubscriptionRequest(RegisteredEvent.name, "unsubscribe");
					await subscriptions.handleRequest(
						getLink(0), request, connectorSetupDate[0].dst, connectorSetupDate[0].src
					);

					subscriptions.broadcast(new RegisteredEvent());
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);
				});

				it("should subtract filters", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, ["foo", "bar"]);
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "unsubscribe", 0, "foo");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);

					subscriptions.broadcast(new RegisteredEvent(), "bar");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});

				it("should remove subscription when empty", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "unsubscribe", 0, "foo");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);
				});

				it("should remain subscribed to all if subtracting a filter", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "unsubscribe", 0, "foo");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent());
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});
			});

			describe("replace", function() {
				it("should replace existing filters", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "bar");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);

					subscriptions.broadcast(new RegisteredEvent(), "bar");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});

				it("should subscribe when no existing subscriber exists", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, "foo");
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await onceConnectorSend(0);
					assertLastEvent(0, RegisteredEvent);
				});

				it("should remove subscription when replacing with empty", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request0 = new lib.SubscriptionRequest(RegisteredEvent.name, "subscribe", 0, "foo");
					await subscriptions.handleRequest(link, request0, connectorData.dst, connectorData.src);

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, []);
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent(), "foo");
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);
				});

				it("should do nothing when replacing with empty if no subscriber exists", async function() {
					const link = getLink(0);
					const connectorData = connectorSetupDate[0];

					const request1 = new lib.SubscriptionRequest(RegisteredEvent.name, "replace", 0, []);
					await subscriptions.handleRequest(link, request1, connectorData.dst, connectorData.src);

					subscriptions.broadcast(new RegisteredEvent());
					await new Promise(r => setImmediate(r));
					assertNoEvent(0);
				});
			});
		});
	});

	describe("class EventSubscriber", function() {
		let mockControl, eventSubscriber;

		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(
				addr({ controlId: 0 }),
				addr("controller"),
			));
			eventSubscriber = new lib.EventSubscriber(RegisteredEvent, mockControl);
		});

		function onceConnectorSend() {
			return events.once(mockControl.connector, "send");
		}

		function assertLastMessage(message) {
			const Message = message.constructor;
			const lastMessage = mockControl.connector.sentMessages.at(-1);
			const name = Message.plugin ? `${Message.plugin}:${Message.name}` : Message.name;
			assert.equal(lastMessage.name, name);
			assert.deepEqual(lastMessage.data, message);
		}

		function assertNoMessageSent() {
			assert.deepEqual(mockControl.connector.sentMessages, []);
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
			it("should send subscribe(all) on first subscription", async function() {
				eventSubscriber.subscribe(() => {});
				await onceConnectorSend();

				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "subscribe", -1, lib.SubscriptionFilters.all()
				));
			});

			it("should send replace(filters) when last callback unsubscribes", async function() {
				const unsubscribe = eventSubscriber.subscribe(() => {});
				await onceConnectorSend();

				unsubscribe();
				await onceConnectorSend();

				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "replace", -1, lib.SubscriptionFilters.empty()
				));
			});

			it("should notify all callbacks", async function() {
				let called1, called2;
				const event = new RegisteredEvent();

				const unsubscribe = eventSubscriber.subscribe((e, s) => { called1 = [e, s]; });
				eventSubscriber.subscribe((e, s) => { called2 = [e, s]; });

				await eventSubscriber._handleEvent(event);

				assert.deepEqual(called1, [event, true]);
				assert.deepEqual(called2, [event, true]);
			});

			it("should not notify unsubscribed callbacks", async function() {
				let called1, called2;
				const event = new RegisteredEvent();

				const unsubscribe = eventSubscriber.subscribe((e, s) => { called1 = [e, s]; });
				eventSubscriber.subscribe((e, s) => { called2 = [e, s]; });

				unsubscribe();
				await new Promise(r => setImmediate(r));
				await eventSubscriber._handleEvent(event);

				assert.deepEqual(called1, undefined);
				assert.deepEqual(called2, [event, true]);
			});

			it("should not throw when unsubscribing multiple times", async function() {
				const unsubscribe = eventSubscriber.subscribe(() => {});
				unsubscribe();
				await onceConnectorSend();
				unsubscribe();
			});
		});

		describe("filters", function() {
			it("should add filters and send subscribe", async function() {
				eventSubscriber.addFilters("foo");
				await onceConnectorSend();

				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "subscribe", -1, lib.SubscriptionFilters.fromShorthand("foo")
				));
			});

			it("should remove filters and send unsubscribe", async function() {
				eventSubscriber.addFilters("foo");
				await onceConnectorSend();

				eventSubscriber.removeFilters("foo");
				await onceConnectorSend();

				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "unsubscribe", -1, lib.SubscriptionFilters.fromShorthand("foo")
				));
			});

			it("should clear filters and unsubscribe when no callbacks", async function() {
				eventSubscriber.addFilters("foo");
				await onceConnectorSend();

				eventSubscriber.clearFilters();
				await onceConnectorSend();

				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "unsubscribe", -1, lib.SubscriptionFilters.all()
				));
			});

			it("should not unsubscribe on clearFilters if callbacks exist", async function() {
				eventSubscriber.subscribe(() => {});
				await onceConnectorSend();

				eventSubscriber.clearFilters();
				await new Promise(r => setImmediate(r));

				// No new message
				assert.equal(mockControl.connector.sentMessages.length, 1);
			});

			it("should correctly report hasFilters", function() {
				eventSubscriber.addFilters(["foo", "bar"]);
				assert.equal(eventSubscriber.hasFilters("foo"), true);
				assert.equal(eventSubscriber.hasFilters("baz"), false);
			});

			it("should only fire when filters are not empty", async function() {
				let called = false;
				eventSubscriber.filteredHandler = () => { called = true; };

				await eventSubscriber._handleEvent(new RegisteredEvent());
				assert.equal(called, false);

				eventSubscriber.addFilters("foo");
				await onceConnectorSend();

				await eventSubscriber._handleEvent(new RegisteredEvent());
				assert.equal(called, true);
			});
		});

		describe("getSnapshot()", function() {
			it("should cache snapshot until state changes", async function() {
				const snap1 = eventSubscriber.getSnapshot();
				const snap2 = eventSubscriber.getSnapshot();
				assert.strictEqual(snap1, snap2);

				await eventSubscriber._handleEvent(new RegisteredEvent());
				const snap3 = eventSubscriber.getSnapshot();
				assert.notStrictEqual(snap1, snap3);

				eventSubscriber.synced = !eventSubscriber.synced;
				const snap4 = eventSubscriber.getSnapshot();
				assert.notStrictEqual(snap3, snap4);
			});
		});

		describe("handleConnectionEvent", function() {
			it("should send replace(all) on reconnect if subscribed", async function() {
				eventSubscriber.subscribe(() => {});
				await onceConnectorSend();

				eventSubscriber.control.connector.emit("connect");
				await onceConnectorSend();
				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "replace", -1, lib.SubscriptionFilters.all()
				));

				mockControl.connector.sentMessages.pop();
				eventSubscriber.handleConnectionEvent("resume");
				await onceConnectorSend();
				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "replace", -1, lib.SubscriptionFilters.all()
				));
			});

			it("should send replace(filters) when only filters exist", async function() {
				eventSubscriber.addFilters("foo");
				await onceConnectorSend();

				eventSubscriber.control.connector.emit("connect");
				await onceConnectorSend();
				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "replace", -1, lib.SubscriptionFilters.fromShorthand("foo")
				));

				mockControl.connector.sentMessages.pop();
				eventSubscriber.handleConnectionEvent("resume");
				await onceConnectorSend();
				assertLastMessage(new lib.SubscriptionRequest(
					RegisteredEvent.name, "replace", -1, lib.SubscriptionFilters.fromShorthand("foo")
				));
			});

			it("should set synced false on close", async function() {
				eventSubscriber.synced = true;
				eventSubscriber.control.connector.emit("close");
				assert.equal(eventSubscriber.synced, false);

				eventSubscriber.synced = true;
				eventSubscriber.handleConnectionEvent("drop");
				assert.equal(eventSubscriber.synced, false);

				eventSubscriber.synced = true;
				eventSubscriber.handleConnectionEvent("close");
				assert.equal(eventSubscriber.synced, false);
			});

			it("should invoke callbacks on close", async function() {
				let calledWith;
				eventSubscriber.subscribe((v, s) => { calledWith = [v, s]; });
				const [msg] = await onceConnectorSend();

				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(false)
				));
				await new Promise(r => setImmediate(r));
				assert.equal(eventSubscriber.synced, true);
				calledWith = undefined;

				eventSubscriber.control.connector.emit("close");
				assert.equal(eventSubscriber.synced, false);
				assert.deepEqual(calledWith, [null, false]);
			});
		});

		describe("._sendRequest()", function() {
			it("should do nothing if connection is not valid", async function() {
				mockControl.connector.valid = false;
				eventSubscriber.subscribe(() => {});
				await new Promise(r => setImmediate(r));
				assertNoMessageSent();
			});

			it("should set synced when no updates returned", async function() {
				let calledWith;
				eventSubscriber.subscribe((e, s) => { calledWith = [e, s]; });
				const [msg] = await onceConnectorSend();

				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(false)
				));

				await new Promise(r => setImmediate(r));
				assert.deepEqual(calledWith, [null, true]);
				assert.equal(eventSubscriber.synced, true);
			});

			it("should set synced when updates returned via _handleEvent", async function() {
				let calledWith;
				eventSubscriber.subscribe((e, s) => { calledWith = [e, s]; });
				const [msg] = await onceConnectorSend();

				mockControl.connector.emit("message", new lib.MessageResponse(0, msg.dst, msg.src,
					lib.SubscriptionRequest.Response.fromJSON(true)
				));

				await new Promise(r => setImmediate(r));
				assert.equal(calledWith, undefined);
				assert.equal(eventSubscriber.synced, false);

				const eventUpdate = new RegisteredEvent();
				eventSubscriber._handleEvent(eventUpdate);

				assert.deepEqual(calledWith, [eventUpdate, true]);
				assert.equal(eventSubscriber.synced, true);
			});

			it("should log error when sendTo throws", async function() {
				let logged;
				const originalError = lib.logger.error;
				lib.logger.error = msg => { logged = msg; };

				// Mock sendTo to throw generic error
				mockControl.sendTo = async function() {
					throw new Error("boom");
				};

				try {
					eventSubscriber.subscribe(() => {});
					await new Promise(r => setImmediate(r));
				} finally {
					lib.logger.error = originalError;
				}
				assert.notEqual(logged, undefined);
			});

			it("should not log error when sendTo throws SessionLost RequestError", async function() {
				let logged;
				const originalError = lib.logger.error;
				lib.logger.error = msg => { logged = msg; };

				mockControl.sendTo = async function() {
					const err = new lib.RequestError("Session lost");
					err.code = "SessionLost";
					throw err;
				};

				try {
					eventSubscriber.subscribe(() => {});
					await new Promise(r => setImmediate(r));
				} finally {
					lib.logger.error = originalError;
				}
				assert.equal(logged, undefined);
			});
		});
	});

	describe("class ValueSubscriber", function() {
		let mockControl, subscriber;

		class ValueEvent {
			static type = "event";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
			constructor(value) {
				this.value = value;
			}
		}
		if (!lib.Link._eventsByName.has(ValueEvent.name)) {
			lib.Link.register(ValueEvent);
		}

		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(
				addr({ controlId: 0 }),
				addr("controller"),
			));
			subscriber = new lib.ValueSubscriber(ValueEvent, mockControl);
		});

		it("should update value on event", async function() {
			const value = { id: 1, updatedAtMs: 100, isDeleted: false };
			await subscriber._handleEvent(new ValueEvent(value));

			assert.deepEqual(subscriber.value, value);
		});

		it("should update lastUpdatedMs from value", async function() {
			const value = { id: 1, updatedAtMs: 123, isDeleted: false };
			await subscriber._handleEvent(new ValueEvent(value));

			assert.equal(subscriber.lastUpdatedMs, 123);
		});

		it("should return value in snapshot", async function() {
			const value = { id: 1, updatedAtMs: 50, isDeleted: false };
			await subscriber._handleEvent(new ValueEvent(value));

			const [snap, synced] = subscriber.getSnapshot();
			assert.deepEqual(snap, value);
			assert.equal(synced, false); // no active subscription
		});

		it("should replace value on newer event", async function() {
			await subscriber._handleEvent(new ValueEvent({
				id: 1, updatedAtMs: 10, isDeleted: false,
			}));

			await subscriber._handleEvent(new ValueEvent({
				id: 1, updatedAtMs: 20, isDeleted: false,
			}));

			assert.equal(subscriber.value.updatedAtMs, 20);
		});
	});

	describe("class MapSubscriber", function() {
		let mockControl, subscriber;

		class MapEvent {
			static type = "event";
			static src = ["controller", "control"];
			static dst = ["controller", "control"];
			static permission = null;
			constructor(updates) {
				this.updates = updates;
			}
		}
		if (!lib.Link._eventsByName.has(MapEvent.name)) {
			lib.Link.register(MapEvent);
		}

		beforeEach(function() {
			mockControl = new MockControl(new MockConnector(
				addr({ controlId: 0 }),
				addr("controller"),
			));
			subscriber = new lib.MapSubscriber(MapEvent, mockControl);
		});

		it("should add values from updates", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
			]));

			assert.equal(subscriber.values.size, 1);
			assert.equal(subscriber.values.get(1).updatedAtMs, 10);
		});

		it("should update existing values", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
			]));

			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 20, isDeleted: false },
			]));

			assert.equal(subscriber.values.get(1).updatedAtMs, 20);
		});

		it("should delete values when isDeleted is true", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
			]));

			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 20, isDeleted: true },
			]));

			assert.equal(subscriber.values.has(1), false);
		});

		it("should compute lastUpdatedMs as max of updates", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
				{ id: 2, updatedAtMs: 50, isDeleted: false },
			]));

			assert.equal(subscriber.lastUpdatedMs, 50);
		});

		it("should return snapshot as a copy", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
			]));

			const [snap] = subscriber.getSnapshot();

			assert.deepEqual(snap, subscriber.values);
			assert.notStrictEqual(snap, subscriber.values); // must be new Map
		});

		it("should not mutate previous snapshots", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
			]));

			const [snap1] = subscriber.getSnapshot();

			await subscriber._handleEvent(new MapEvent([
				{ id: 2, updatedAtMs: 20, isDeleted: false },
			]));

			const [snap2] = subscriber.getSnapshot();

			assert.equal(snap1.has(2), false);
			assert.equal(snap2.has(2), true);
		});

		it("should handle multiple updates correctly", async function() {
			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 10, isDeleted: false },
				{ id: 2, updatedAtMs: 20, isDeleted: false },
			]));

			await subscriber._handleEvent(new MapEvent([
				{ id: 1, updatedAtMs: 30, isDeleted: false },
				{ id: 2, updatedAtMs: 40, isDeleted: true },
			]));

			assert.equal(subscriber.values.get(1).updatedAtMs, 30);
			assert.equal(subscriber.values.has(2), false);
		});

		it("should warn on same timestamp but different content", async function() {
			let logged = false;
			const originalWarn = lib.logger.warn;
			lib.logger.warn = msg => { logged = msg; };

			try {
				await subscriber._handleEvent(new MapEvent([
					{ id: 1, updatedAtMs: 10, isDeleted: false, foo: "a" },
				]));

				await subscriber._handleEvent(new MapEvent([
					{ id: 1, updatedAtMs: 10, isDeleted: false, foo: "b" },
				]));
			} finally {
				lib.logger.warn = originalWarn;
			}
			assert.notEqual(logged, undefined);
		});
	});
});
