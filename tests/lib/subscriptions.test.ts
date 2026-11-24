import t from "tap";
import * as lib from "@clusterio/lib";
import { TestWebSocketConnector, addr, linkPair, recordedLink, settle } from "../shared/link.ts";

const controller = addr("controller");
const control1 = addr({ controlId: 1 });
const control2 = addr({ controlId: 2 });

type Item = { id: number, updatedAtMs: number, isDeleted: boolean, [key: string]: unknown };

// Test events, registered once here and never changed after.
class TestEvent {
	declare ["constructor"]: typeof TestEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	filters?: string | string[];
	constructor(filters?: string | string[]) {
		if (filters !== undefined) {
			this.filters = filters;
		}
	}
}
class StringPermissionEvent {
	declare ["constructor"]: typeof StringPermissionEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "StringPermission";
}
class FunctionPermissionEvent {
	declare ["constructor"]: typeof FunctionPermissionEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission(user: lib.IUser, _message: lib.MessageRequest) {
		user.checkPermission("FunctionPermission" as any);
	}
}
class ValueEvent {
	declare ["constructor"]: typeof ValueEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	value: Item;
	constructor(value: Item) { this.value = value; }
	static jsonSchema = { type: "object", properties: { value: { type: "object" } }, required: ["value"] };
	static fromJSON(json: any) { return new this(json.value); }
}
class MapEvent {
	declare ["constructor"]: typeof MapEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	updates: Item[];
	constructor(updates: Item[]) { this.updates = updates; }
	static jsonSchema = { type: "object", properties: { updates: { type: "array" } }, required: ["updates"] };
	static fromJSON(json: any) { return new this(json.updates); }
}
class UnregisteredEvent {
	declare ["constructor"]: typeof UnregisteredEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
}
for (const Event of [TestEvent, StringPermissionEvent, FunctionPermissionEvent, ValueEvent, MapEvent]) {
	lib.Link.register(Event as any);
}

const filters = (shorthand?: string | string[]) => lib.SubscriptionFilters.fromShorthand(shorthand);
const all = () => lib.SubscriptionFilters.all();
const empty = () => lib.SubscriptionFilters.empty();
const item = (id: number, updatedAtMs: number, extra: object = {}): Item => ({
	id, updatedAtMs, isDeleted: false, ...extra,
});

/** User denying one permission and recording the checks */
function testUser(denied?: string) {
	const checked: string[] = [];
	const user = {
		checkPermission(permission: string) {
			checked.push(permission);
			if (permission === denied) {
				throw new lib.PermissionError("Permission denied");
			}
		},
	} as unknown as lib.IUser;
	return { user, checked };
}

t.test("SubscriptionFilters", async t1 => {
	t1.test("SubscriptionFilters.all()", async t2 => {
		t2.test("accepts everything", async t3 => {
			const f = lib.SubscriptionFilters.all();
			t3.equal(f.isAll(), true);
			t3.equal(f.isEmpty(), false);
			t3.equal(f.accepts("foo"), true);
		});
	});

	t1.test("SubscriptionFilters.empty()", async t2 => {
		t2.test("accepts nothing", async t3 => {
			const f = lib.SubscriptionFilters.empty();
			t3.equal(f.isAll(), false);
			t3.equal(f.isEmpty(), true);
			t3.equal(f.accepts("foo"), false);
		});
	});

	t1.test("SubscriptionFilters.fromShorthand()", async t2 => {
		t2.test("treats undefined as all", async t3 => {
			t3.equal(filters(undefined).isAll(), true);
		});

		t2.test("accepts a string", async t3 => {
			const f = filters("foo");
			t3.equal(f.isAll(), false);
			t3.strictSame(f.toJSON(), ["foo"]);
		});

		t2.test("accepts an array", async t3 => {
			t3.strictSame(filters(["foo", "bar"]).toJSON(), ["foo", "bar"]);
		});

		t2.test("treats an empty array as empty", async t3 => {
			t3.equal(filters([]).isEmpty(), true);
		});
	});

	t1.test("SubscriptionFilters.fromJSON()", async t2 => {
		t2.test("round trips filters", async t3 => {
			const f = lib.SubscriptionFilters.fromJSON(JSON.parse(JSON.stringify(filters(["foo", "bar"]))));
			t3.strictSame(f.toJSON(), ["foo", "bar"]);
		});

		t2.test("does not preserve all", async t3 => {
			// SubscriptionRequest leaves the filters out to mean all
			const f = lib.SubscriptionFilters.fromJSON(JSON.parse(JSON.stringify(lib.SubscriptionFilters.all())));
			t3.equal(f.isAll(), false);
			t3.equal(f.isEmpty(), true);
		});
	});

	t1.test("toString()", async t2 => {
		t2.test("describes the filter", async t3 => {
			t3.equal(lib.SubscriptionFilters.all().toString(), "[SubscriptionFilters All]");
			t3.equal(lib.SubscriptionFilters.empty().toString(), "[SubscriptionFilters Empty]");
			t3.equal(filters("foo").toString(), "[SubscriptionFilters Set<1>]");
			t3.equal(filters(["foo", "bar"]).toString(), "[SubscriptionFilters Set<2>]");
		});
	});

	t1.test("accepts()", async t2 => {
		t2.test("matches exact values", async t3 => {
			const f = filters("foo");
			t3.equal(f.accepts("foo"), true);
			t3.equal(f.accepts("fo"), false);
		});
	});

	t1.test("extends()", async t2 => {
		const cases: [string, () => lib.SubscriptionFilters, () => lib.SubscriptionFilters, boolean][] = [
			["all extends a set", all, () => filters("foo"), true],
			["all extends all", all, all, true],
			["a superset extends a set", () => filters(["foo", "bar"]), () => filters("foo"), true],
			["a set extends empty", () => filters("foo"), empty, true],
			["a subset does not extend a set", () => filters("foo"), () => filters(["foo", "bar"]), false],
			["a set does not extend all", () => filters("foo"), all, false],
		];
		for (const [name, a, b, expected] of cases) {
			t2.test(name, async t3 => {
				t3.equal(a().extends(b()), expected);
			});
		}
	});

	t1.test("intersects()", async t2 => {
		const cases: [string, () => lib.SubscriptionFilters, () => lib.SubscriptionFilters, boolean][] = [
			["sets sharing a value", () => filters("foo"), () => filters(["foo", "bar"]), true],
			["disjoint sets", () => filters("foo"), () => filters("bar"), false],
			["all and a set", all, () => filters("foo"), true],
			["all and all", all, all, true],
			["all and empty", all, empty, false],
		];
		for (const [name, a, b, expected] of cases) {
			t2.test(`is ${expected} for ${name} either way round`, async t3 => {
				t3.equal(a().intersects(b()), expected);
				t3.equal(b().intersects(a()), expected);
			});
		}
	});

	t1.test("union()", async t2 => {
		t2.test("merges sets", async t3 => {
			const f = filters("foo");
			f.union(filters("bar"));
			t3.strictSame(f.toJSON(), ["foo", "bar"]);
		});

		t2.test("becomes all with all", async t3 => {
			const f = filters("foo");
			f.union(lib.SubscriptionFilters.all());
			t3.equal(f.isAll(), true);
			t3.strictSame(f.toJSON(), []);
		});

		t2.test("stays all", async t3 => {
			const f = lib.SubscriptionFilters.all();
			f.union(filters("foo"));
			t3.equal(f.isAll(), true);
			t3.strictSame(f.toJSON(), []);
		});
	});

	t1.test("subtract()", async t2 => {
		t2.test("removes values", async t3 => {
			const f = filters(["foo", "bar"]);
			f.subtract(filters(["foo", "baz"]));
			t3.strictSame(f.toJSON(), ["bar"]);
		});

		t2.test("becomes empty when subtracting all", async t3 => {
			const f = filters("foo");
			f.subtract(lib.SubscriptionFilters.all());
			t3.equal(f.isEmpty(), true);
			const g = lib.SubscriptionFilters.all();
			g.subtract(lib.SubscriptionFilters.all());
			t3.equal(g.isEmpty(), true);
		});

		t2.test("leaves all unchanged when subtracting a set", async t3 => {
			const f = lib.SubscriptionFilters.all();
			f.subtract(filters("foo"));
			t3.equal(f.isAll(), true);
		});
	});
});

t.test("SubscriptionRequest", async t1 => {
	t1.test("constructor()", async t2 => {
		t2.test("maps the deprecated boolean action", async t3 => {
			t3.equal(new lib.SubscriptionRequest("TestEvent", true, 0).action, "subscribe");
			t3.equal(new lib.SubscriptionRequest("TestEvent", false, 0).action, "unsubscribe");
		});

		t2.test("converts shorthand filters", async t3 => {
			t3.strictSame(new lib.SubscriptionRequest("TestEvent", true, 0, "foo").filters.toJSON(), ["foo"]);
			t3.strictSame(new lib.SubscriptionRequest("TestEvent", true, 0, ["a", "b"]).filters.toJSON(), ["a", "b"]);
			t3.equal(new lib.SubscriptionRequest("TestEvent", true, 0).filters.isAll(), true);
		});

		t2.test("uses SubscriptionFilters as given", async t3 => {
			const f = filters("foo");
			t3.equal(new lib.SubscriptionRequest("TestEvent", "replace", 0, f).filters, f);
		});

		t2.test("defaults lastRequestTimeMs to 0", async t3 => {
			t3.equal(new lib.SubscriptionRequest("TestEvent", "subscribe", undefined).lastRequestTimeMs, 0);
		});

		t2.test("throws for unregistered events", async t3 => {
			t3.throws(
				() => new lib.SubscriptionRequest("UnregisteredEvent", "subscribe", 0),
				{ message: "Unregistered Event class UnregisteredEvent" },
			);
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out filters accepting all", async t3 => {
			t3.strictSame(
				new lib.SubscriptionRequest("TestEvent", "subscribe", 5).toJSON(),
				["TestEvent", "subscribe", 5],
			);
		});

		t2.test("includes other filters", async t3 => {
			t3.strictSame(
				new lib.SubscriptionRequest("TestEvent", "replace", 5, lib.SubscriptionFilters.empty()).toJSON(),
				["TestEvent", "replace", 5, []],
			);
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("round trips every action and filter kind", async t3 => {
			for (const action of ["subscribe", "unsubscribe", "replace"] as const) {
				for (const f of [lib.SubscriptionFilters.all(), lib.SubscriptionFilters.empty(), filters(["a", "b"])]) {
					const request = new lib.SubscriptionRequest("TestEvent", action, 7, f);
					const copy = lib.SubscriptionRequest.fromJSON(JSON.parse(JSON.stringify(request)));
					t3.strictSame(copy, request, `${action} ${f}`);
				}
			}
		});

		t2.test("throws for unregistered events", async t3 => {
			t3.throws(
				() => lib.SubscriptionRequest.fromJSON(["UnregisteredEvent", "subscribe", 0]),
				{ message: "Unregistered Event class UnregisteredEvent" },
			);
		});
	});

	t1.test("SubscriptionRequest.permission()", async t2 => {
		function check(data: unknown, denied?: string) {
			const { user, checked } = testUser(denied);
			const message = new lib.MessageRequest(1, control1, controller, "SubscriptionRequest", data);
			lib.SubscriptionRequest.permission(user, message);
			return checked;
		}

		t2.test("checks a string permission of the event", async t3 => {
			t3.strictSame(check(["StringPermissionEvent", "subscribe", 0]), ["StringPermission"]);
			t3.throws(
				() => check(["StringPermissionEvent", "subscribe", 0], "StringPermission"),
				{ constructor: lib.PermissionError, message: "Permission denied" },
			);
		});

		t2.test("calls a function permission of the event", async t3 => {
			t3.strictSame(check(["FunctionPermissionEvent", "subscribe", 0]), ["FunctionPermission"]);
		});

		t2.test("checks nothing for events without a permission", async t3 => {
			t3.strictSame(check(["TestEvent", "subscribe", 0]), []);
		});

		t2.test("checks nothing for unknown events or missing data", async t3 => {
			t3.strictSame(check(["UnregisteredEvent", "subscribe", 0]), []);
			t3.strictSame(check(undefined), []);
			t3.strictSame(check(null), []);
		});
	});
});

t.test("SubscriptionController", async t1 => {
	// Controller with two controls connected, each records the events it receives.
	function setup(maxFilters?: number) {
		const subscriptions = new lib.SubscriptionController(maxFilters);
		const controls = [control1, control2].map(address => {
			const { link, connector, sent } = recordedLink(controller, address);
			const events = () => sent.filter(message => message.type === "event").map(message => message.name);
			return { link, connector, address, sent, events };
		});
		const request = (index: number, ...args: [string, any, number?, any?]) => subscriptions.handleRequest(
			controls[index].link, new lib.SubscriptionRequest(...args), controls[index].address, controller,
		);
		return { subscriptions, controls, request };
	}

	t1.test("handle()", async t2 => {
		t2.test("throws for unregistered events", async t3 => {
			const { subscriptions } = setup();
			t3.throws(
				() => subscriptions.handle(UnregisteredEvent),
				{ message: "Unregistered Event class UnregisteredEvent" },
			);
		});

		t2.test("throws for events already handled", async t3 => {
			const { subscriptions } = setup();
			subscriptions.handle(TestEvent);
			t3.throws(() => subscriptions.handle(TestEvent), { message: "Event TestEvent is already registered" });
		});
	});

	t1.test("broadcast()", async t2 => {
		t2.test("throws for unregistered events", async t3 => {
			const { subscriptions } = setup();
			t3.throws(
				() => subscriptions.broadcast(new UnregisteredEvent() as any),
				{ message: "Unregistered Event class UnregisteredEvent" },
			);
		});

		t2.test("throws for events not handled", async t3 => {
			const { subscriptions } = setup();
			t3.throws(
				() => subscriptions.broadcast(new TestEvent() as any),
				{ message: "Event TestEvent is not a registered as subscribable" },
			);
		});

		t2.test("sends the event to every subscriber", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "subscribe", 0);
			await request(1, "TestEvent", "subscribe", 0);
			subscriptions.broadcast(new TestEvent() as any);
			t3.strictSame(controls.map(c => c.events()), [["TestEvent"], ["TestEvent"]]);
			t3.strictSame(controls[0].sent[0].dst, control1);
		});

		t2.test("sends only to subscribers whose filters match", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "replace", 0, "foo");
			await request(1, "TestEvent", "replace", 0, "bar");
			subscriptions.broadcast(new TestEvent() as any, "foo");
			t3.strictSame(controls.map(c => c.events()), [["TestEvent"], []]);
			subscriptions.broadcast(new TestEvent() as any, ["bar", "baz"]);
			t3.strictSame(controls.map(c => c.events()), [["TestEvent"], ["TestEvent"]]);
		});

		t2.test("sends filtered events to subscribers without filters", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "subscribe", 0);
			subscriptions.broadcast(new TestEvent() as any, "foo");
			t3.strictSame(controls[0].events(), ["TestEvent"]);
		});

		t2.test("uses the filters property of the event", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "replace", 0, "foo");
			await request(1, "TestEvent", "replace", 0, "bar");
			subscriptions.broadcast(new TestEvent("foo") as any);
			t3.strictSame(controls.map(c => c.events()), [["TestEvent"], []]);
		});

		t2.test("prefers the filters argument over the property", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "replace", 0, "foo");
			subscriptions.broadcast(new TestEvent("foo") as any, "bar");
			t3.strictSame(controls[0].events(), []);
		});

		t2.test("drops subscribers whose connector is closing", async t3 => {
			const subscriptions = new lib.SubscriptionController();
			subscriptions.handle(TestEvent);
			const closed = new lib.Link(new TestWebSocketConnector(controller, control1));
			const request = new lib.SubscriptionRequest("TestEvent", "subscribe", 0);
			await subscriptions.handleRequest(closed, request, control1, controller);
			t3.equal(subscriptions._events.get("TestEvent")!.subscriptions.size, 1);
			subscriptions.broadcast(new TestEvent() as any);
			t3.equal(subscriptions._events.get("TestEvent")!.subscriptions.size, 0);
		});
	});

	t1.test("unsubscribeLink()", async t2 => {
		t2.test("removes every subscription of the link", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			subscriptions.handle(MapEvent);
			await request(0, "TestEvent", "subscribe", 0);
			await request(0, "MapEvent", "subscribe", 0);
			await request(1, "TestEvent", "subscribe", 0);
			subscriptions.unsubscribeLink(controls[0].link);
			subscriptions.broadcast(new TestEvent() as any);
			subscriptions.broadcast(new MapEvent([]) as any);
			t3.strictSame(controls.map(c => c.events()), [[], ["TestEvent"]]);
		});
	});

	t1.test("unsubscribeAddress()", async t2 => {
		t2.test("removes every subscription of the address", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent);
			await request(0, "TestEvent", "subscribe", 0);
			await request(1, "TestEvent", "subscribe", 0);
			subscriptions.unsubscribeAddress(new lib.Address(lib.Address.control, 1, 99));
			subscriptions.broadcast(new TestEvent() as any);
			t3.strictSame(controls.map(c => c.events()), [[], ["TestEvent"]]);
		});
	});

	t1.test("checkLinkPermissions()", async t2 => {
		async function permissionSetup() {
			const setupResult = setup();
			const { subscriptions, request } = setupResult;
			subscriptions.handle(TestEvent);
			subscriptions.handle(StringPermissionEvent);
			subscriptions.handle(FunctionPermissionEvent);
			for (const index of [0, 1]) {
				for (const name of ["TestEvent", "StringPermissionEvent", "FunctionPermissionEvent"]) {
					await request(index, name, "subscribe", 0);
				}
			}
			const broadcastAll = () => {
				for (const Event of [TestEvent, StringPermissionEvent, FunctionPermissionEvent]) {
					subscriptions.broadcast(new Event() as any);
				}
			};
			return { ...setupResult, broadcastAll };
		}

		t2.test("removes subscriptions with a string permission the user lost", async t3 => {
			const { subscriptions, controls, broadcastAll } = await permissionSetup();
			subscriptions.checkLinkPermissions(controls[0].link, testUser("StringPermission").user);
			broadcastAll();
			t3.strictSame(controls[0].events(), ["TestEvent", "FunctionPermissionEvent"]);
			t3.equal(controls[1].events().length, 3, "other links keep their subscriptions");
		});

		t2.test("removes subscriptions with a function permission the user lost", async t3 => {
			const { subscriptions, controls, broadcastAll } = await permissionSetup();
			subscriptions.checkLinkPermissions(controls[0].link, testUser("FunctionPermission").user);
			broadcastAll();
			t3.strictSame(controls[0].events(), ["TestEvent", "StringPermissionEvent"]);
		});

		t2.test("keeps subscriptions the user has permission for", async t3 => {
			const { subscriptions, controls, broadcastAll } = await permissionSetup();
			const { user, checked } = testUser();
			subscriptions.checkLinkPermissions(controls[0].link, user);
			broadcastAll();
			t3.equal(controls[0].events().length, 3);
			t3.strictSame(checked, ["StringPermission", "FunctionPermission"]);
		});
	});

	t1.test("handleRequest()", async t2 => {
		t2.test("rejects unregistered events", async t3 => {
			const { subscriptions, controls } = setup();
			const request = new lib.SubscriptionRequest("TestEvent", "subscribe", 0);
			request.eventName = "UnregisteredEvent";
			await t3.rejects(
				subscriptions.handleRequest(controls[0].link, request, control1, controller),
				{ message: "Event UnregisteredEvent is not a registered event" },
			);
		});

		t2.test("rejects events not handled", async t3 => {
			const { request } = setup();
			await t3.rejects(
				request(0, "TestEvent", "subscribe", 0),
				{ message: "Event TestEvent is not a registered as subscribable" },
			);
		});

		t2.test("rejects unknown actions", async t3 => {
			const { subscriptions, request } = setup();
			subscriptions.handle(TestEvent);
			await t3.rejects(request(0, "TestEvent", "bad" as any, 0), { message: "unreachable case: bad" });
		});

		t2.test("resolves to whether a replay was sent", async t3 => {
			const { subscriptions, controls, request } = setup();
			subscriptions.handle(TestEvent, async () => new TestEvent() as any);
			subscriptions.handle(MapEvent, async () => null);
			subscriptions.handle(StringPermissionEvent);
			t3.equal(await request(0, "TestEvent", "subscribe", 0), true);
			t3.equal(await request(0, "MapEvent", "subscribe", 0), false);
			t3.equal(await request(0, "StringPermissionEvent", "subscribe", 0), false);
			t3.strictSame(controls[0].events(), ["TestEvent"]);
		});

		t2.test("passes the request to the update handler", async t3 => {
			const { subscriptions, request } = setup();
			const calls: unknown[] = [];
			subscriptions.handle(TestEvent, async (req, src, dst) => {
				calls.push([req.toJSON(), src, dst]);
				return null;
			});
			await request(0, "TestEvent", "replace", 12, "foo");
			t3.strictSame(calls, [[["TestEvent", "replace", 12, ["foo"]], control1, controller]]);
		});

		t2.test("stores the subscriber without the request id", async t3 => {
			const { subscriptions, controls } = setup();
			subscriptions.handle(TestEvent, async () => new TestEvent() as any);
			const src = new lib.Address(lib.Address.control, 1, 213);
			for (const action of ["subscribe", "replace"] as const) {
				const request = new lib.SubscriptionRequest("TestEvent", action, 0, filters("a"));
				await subscriptions.handleRequest(controls[0].link, request, src, controller);
			}
			subscriptions.broadcast(new TestEvent() as any, "a");
			t3.strictSame(controls[0].sent.map(message => message.dst), [control1, control1, control1]);
		});

		t2.test("subscribe", async t3 => {
			t3.test("unions filters of an existing subscriber", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, "foo");
				await request(0, "TestEvent", "subscribe", 0, "bar");
				for (const f of ["foo", "bar", "baz"]) {
					subscriptions.broadcast(new TestEvent(f) as any);
				}
				t4.equal(controls[0].events().length, 2);
			});

			t3.test("unions with all when no filters are given", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, "foo");
				await request(0, "TestEvent", "subscribe", 0);
				subscriptions.broadcast(new TestEvent("baz") as any);
				t4.equal(controls[0].events().length, 1);
			});

			t3.test("rejects going over the filter limit", async t4 => {
				const { subscriptions, controls, request } = setup(2);
				subscriptions.handle(TestEvent);
				await t4.rejects(
					request(0, "TestEvent", "subscribe", 0, ["a", "b", "c"]),
					{ constructor: lib.ValidationError, message: "Subscription exceeds the limit of 2 filters" },
				);
				await request(0, "TestEvent", "subscribe", 0, ["a", "b"]);
				await t4.rejects(
					request(0, "TestEvent", "subscribe", 0, "c"),
					{ constructor: lib.ValidationError, message: "Subscription exceeds the limit of 2 filters" },
				);
				subscriptions.broadcast(new TestEvent("c") as any);
				t4.strictSame(controls[0].events(), []);
			});

			t3.test("does not count filters already held towards the limit", async t4 => {
				const { request, subscriptions } = setup(2);
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, ["a", "b"]);
				t4.equal(await request(0, "TestEvent", "subscribe", 0, ["a", "b"]), false);
			});

			t3.test("does not limit a subscriber to all", async t4 => {
				const { request, subscriptions } = setup(2);
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0);
				t4.equal(await request(0, "TestEvent", "subscribe", 0, ["a", "b", "c"]), false);
			});

			t3.test("does not limit filters when the limit is 0", async t4 => {
				const { request, subscriptions } = setup();
				subscriptions.handle(TestEvent);
				t4.equal(await request(0, "TestEvent", "subscribe", 0, ["a", "b", "c"]), false);
			});
		});

		t2.test("unsubscribe", async t3 => {
			t3.test("does nothing without a subscription", async t4 => {
				const { subscriptions, request } = setup();
				const calls: unknown[] = [];
				subscriptions.handle(TestEvent, async () => { calls.push(1); return null; });
				t4.equal(await request(0, "TestEvent", "unsubscribe", 0), false);
				t4.strictSame(calls, [], "update handler is not called");
			});

			t3.test("removes a subscription to all", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0);
				await request(0, "TestEvent", "unsubscribe", 0);
				subscriptions.broadcast(new TestEvent() as any);
				t4.strictSame(controls[0].events(), []);
			});

			t3.test("subtracts filters", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, ["foo", "bar"]);
				await request(0, "TestEvent", "unsubscribe", 0, "foo");
				subscriptions.broadcast(new TestEvent("foo") as any);
				t4.strictSame(controls[0].events(), []);
				subscriptions.broadcast(new TestEvent("bar") as any);
				t4.strictSame(controls[0].events(), ["TestEvent"]);
			});

			t3.test("removes the subscriber when no filters are left", async t4 => {
				const { subscriptions, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, "foo");
				await request(0, "TestEvent", "unsubscribe", 0, "foo");
				t4.equal(subscriptions._events.get("TestEvent")!.subscriptions.size, 0);
			});

			t3.test("keeps a subscription to all when subtracting a filter", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0);
				await request(0, "TestEvent", "unsubscribe", 0, "foo");
				subscriptions.broadcast(new TestEvent("foo") as any);
				t4.strictSame(controls[0].events(), ["TestEvent"]);
			});
		});

		t2.test("replace", async t3 => {
			t3.test("replaces existing filters", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, "foo");
				await request(0, "TestEvent", "replace", 0, "bar");
				subscriptions.broadcast(new TestEvent("foo") as any);
				t4.strictSame(controls[0].events(), []);
				subscriptions.broadcast(new TestEvent("bar") as any);
				t4.strictSame(controls[0].events(), ["TestEvent"]);
			});

			t3.test("subscribes when there is no subscriber", async t4 => {
				const { subscriptions, controls, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "replace", 0, "foo");
				subscriptions.broadcast(new TestEvent("foo") as any);
				t4.strictSame(controls[0].events(), ["TestEvent"]);
			});

			t3.test("removes the subscriber when replacing with empty", async t4 => {
				const { subscriptions, request } = setup();
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, "foo");
				t4.equal(await request(0, "TestEvent", "replace", 0, []), false);
				t4.equal(subscriptions._events.get("TestEvent")!.subscriptions.size, 0);
			});

			t3.test("does nothing when replacing with empty and there is no subscriber", async t4 => {
				const { subscriptions, request } = setup();
				const calls: unknown[] = [];
				subscriptions.handle(TestEvent, async () => { calls.push(1); return null; });
				t4.equal(await request(0, "TestEvent", "replace", 0, []), false);
				t4.strictSame(calls, []);
				t4.equal(subscriptions._events.get("TestEvent")!.subscriptions.size, 0);
			});

			t3.test("rejects going over the filter limit", async t4 => {
				const { subscriptions, request } = setup(2);
				subscriptions.handle(TestEvent);
				await request(0, "TestEvent", "subscribe", 0, ["a"]);
				await t4.rejects(
					request(0, "TestEvent", "replace", 0, ["a", "b", "c"]),
					{ constructor: lib.ValidationError, message: "Subscription exceeds the limit of 2 filters" },
				);
				t4.strictSame(subscriptions._events.get("TestEvent")!.subscriptions.get("4:1" as any), undefined);
			});
		});
	});
});

// Control connected to a controller that serves subscriptions through a SubscriptionController.
function connected() {
	const { link: control, peer: controllerLink } = linkPair(control1, controller);
	const subscriptions = new lib.SubscriptionController();
	controllerLink.handle(lib.SubscriptionRequest, (request, src, dst) => subscriptions.handleRequest(
		controllerLink, request, src, dst,
	));
	return { control, controllerLink, subscriptions };
}

// Control whose requests are recorded, answered with respond().
function recorded() {
	const { link: control, connector, sent } = recordedLink(control1, controller);
	const requests = () => sent.filter(m => m.name === "SubscriptionRequest").map(m => m.data.toJSON());
	const respond = (value: boolean, index = -1) => {
		connector.emit("message", new lib.MessageResponse(1, controller, sent.at(index).src, value));
	};
	return { control, connector, sent, requests, respond };
}

// Known bug, see the todo tests in getSnapshot()
const snapshotTodo = "snapshot is only remade when lastUpdatedMs changes";

const nextTimeout = () => new Promise(resolve => { setTimeout(resolve); });

t.test("EventSubscriber", async t1 => {
	t1.test("constructor()", async t2 => {
		t2.test("handles the event on the control", async t3 => {
			const { control } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			t3.equal(subscriber.control, control);
			t3.equal(control._eventHandlers.has(TestEvent as any), true);
		});

		t2.test("throws for unregistered events", async t3 => {
			const { control } = recorded();
			t3.throws(
				() => new lib.EventSubscriber(UnregisteredEvent, control),
				{ message: "Unregistered Event class UnregisteredEvent" },
			);
		});

		t2.test("shares one connect and close listener per connector", async t3 => {
			const { control, connector } = recorded();
			const listeners = () => [connector.listenerCount("connect"), connector.listenerCount("close")];
			const subscribers: lib.EventSubscriber<any>[] = [new lib.EventSubscriber(TestEvent, control)];
			const counts = listeners();
			subscribers.push(new lib.EventSubscriber(MapEvent, control), new lib.EventSubscriber(ValueEvent, control));
			t3.equal(subscribers.length, 3);
			t3.strictSame(listeners(), counts);
		});

		t2.test("passes connect and close to every subscriber on the connector only", async t3 => {
			const { control, connector } = recorded();
			const other = recorded();
			const received: string[] = [];
			const cases = [
				["a", control, TestEvent], ["b", control, MapEvent], ["c", other.control, TestEvent],
			] as const;
			for (const [name, link, Event] of cases) {
				const subscriber = new lib.EventSubscriber(Event as any, link);
				t3.capture(subscriber, "handleConnectionEvent", event => { received.push(`${name} ${event}`); });
			}
			connector.emit("close");
			connector.emit("connect");
			t3.strictSame(received, ["a close", "b close", "a connect", "b connect"]);
		});

		t2.test("listens for account updates when the control reports them", async t3 => {
			const { control, requests } = recorded();
			const handlers: (() => void)[] = [];
			(control as any).onAccountUpdate = (handler: () => void) => { handlers.push(handler); };
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			t3.equal(handlers.length, 1);
			subscriber.subscribe(() => {});
			handlers[0]();
			await settle();
			t3.strictSame(requests(), [["TestEvent", "subscribe", -1], ["TestEvent", "replace", -1]]);
		});
	});

	t1.test("subscribe()", async t2 => {
		t2.test("subscribes to all on the first callback only", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			subscriber.subscribe(() => {});
			t3.strictSame(requests(), [["TestEvent", "subscribe", -1]]);
		});

		t2.test("replaces with the filters when the last callback unsubscribes", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const unsubscribe1 = subscriber.subscribe(() => {});
			const unsubscribe2 = subscriber.subscribe(() => {});
			unsubscribe1();
			await nextTimeout();
			t3.equal(requests().length, 1);
			unsubscribe2();
			await nextTimeout();
			t3.strictSame(requests().at(-1), ["TestEvent", "replace", -1, []]);
		});

		t2.test("delays unsubscribing so a resubscribe in the same tick sends nothing", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const unsubscribe = subscriber.subscribe(() => {});
			unsubscribe();
			subscriber.subscribe(() => {});
			await nextTimeout();
			t3.equal(requests().length, 1);
		});

		t2.test("unsubscribes without setImmediate, which browsers lack", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const unsubscribe = subscriber.subscribe(() => {});
			const original = globalThis.setImmediate;
			delete (globalThis as any).setImmediate;
			try {
				unsubscribe();
			} finally {
				globalThis.setImmediate = original;
			}
			await nextTimeout();
			t3.equal(requests().length, 2);
		});

		t2.test("ignores repeated calls of the returned function", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const unsubscribe = subscriber.subscribe(() => {});
			unsubscribe();
			await nextTimeout();
			unsubscribe();
			await nextTimeout();
			t3.equal(requests().length, 2);
		});

		t2.test("calls every subscribed callback with received events", async t3 => {
			const { control, subscriptions } = connected();
			subscriptions.handle(TestEvent);
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const calls: unknown[] = [];
			const unsubscribe = subscriber.subscribe((event, synced) => { calls.push(["a", event, synced]); });
			subscriber.subscribe((event, synced) => { calls.push(["b", event, synced]); });
			await settle();
			calls.length = 0;
			unsubscribe();
			await nextTimeout();
			subscriptions.broadcast(new TestEvent() as any);
			t3.strictSame(calls, [["b", new TestEvent(), true]]);
		});
	});

	t1.test("addFilters()", async t2 => {
		t2.test("sends subscribe with the added filters", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.addFilters("foo");
			subscriber.addFilters(["bar", "baz"]);
			subscriber.addFilters(filters("qux"));
			t3.strictSame(requests(), [
				["TestEvent", "subscribe", -1, ["foo"]],
				["TestEvent", "subscribe", -1, ["bar", "baz"]],
				["TestEvent", "subscribe", -1, ["qux"]],
			]);
		});

		t2.test("receives only events matching the filters", async t3 => {
			const { control, subscriptions } = connected();
			subscriptions.handle(TestEvent);
			const calls: unknown[] = [];
			const handler = (event: TestEvent | null, synced: boolean) => { calls.push([event, synced]); };
			const subscriber = new lib.EventSubscriber(TestEvent, control, handler);
			subscriber.addFilters("foo");
			await settle();
			t3.strictSame(calls, [[null, true]], "notified as synced");
			subscriptions.broadcast(new TestEvent("bar") as any);
			subscriptions.broadcast(new TestEvent("foo") as any);
			t3.equal(calls.length, 2);
		});
	});

	t1.test("removeFilters()", async t2 => {
		t2.test("sends unsubscribe with the removed filters", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.addFilters(["foo", "bar"]);
			subscriber.removeFilters("foo");
			subscriber.removeFilters(filters(["bar"]));
			t3.strictSame(requests().slice(1), [
				["TestEvent", "unsubscribe", -1, ["foo"]],
				["TestEvent", "unsubscribe", -1, ["bar"]],
			]);
			t3.equal(subscriber.hasFilters("bar"), false);
		});
	});

	t1.test("hasFilters()", async t2 => {
		t2.test("is true only when every filter was added", async t3 => {
			const { control } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.addFilters(["foo", "bar"]);
			t3.equal(subscriber.hasFilters("foo"), true);
			t3.equal(subscriber.hasFilters(filters(["foo", "bar"])), true);
			t3.equal(subscriber.hasFilters(["foo", "baz"]), false);
		});
	});

	t1.test("clearFilters()", async t2 => {
		t2.test("unsubscribes from all without callbacks", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.addFilters("foo");
			subscriber.clearFilters();
			t3.strictSame(requests().at(-1), ["TestEvent", "unsubscribe", -1]);
			t3.equal(subscriber.hasFilters("foo"), false);
		});

		t2.test("sends nothing while there are callbacks", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			subscriber.addFilters("foo");
			subscriber.clearFilters();
			t3.equal(requests().length, 2);
		});

		t2.test("stops calling the filtered handler", async t3 => {
			const { control, subscriptions } = connected();
			subscriptions.handle(TestEvent);
			const calls: unknown[] = [];
			const subscriber = new lib.EventSubscriber(TestEvent, control, event => { calls.push(event); });
			subscriber.subscribe(() => {});
			subscriber.addFilters("foo");
			await settle();
			calls.length = 0;
			subscriber.clearFilters();
			subscriptions.broadcast(new TestEvent("foo") as any);
			t3.strictSame(calls, []);
		});
	});

	t1.test("handleConnectionEvent()", async t2 => {
		for (const event of ["connect", "resume"] as const) {
			t2.test(`resends the subscription on ${event}`, async t3 => {
				const { control, requests } = recorded();
				const callbacks = new lib.EventSubscriber(TestEvent, control);
				const filtered = new lib.EventSubscriber(MapEvent, control);
				callbacks.subscribe(() => {});
				filtered.addFilters("foo");
				callbacks.handleConnectionEvent(event);
				filtered.handleConnectionEvent(event);
				await settle();
				t3.strictSame(
					requests().slice(2),
					[["TestEvent", "replace", -1], ["MapEvent", "replace", -1, ["foo"]]],
				);
			});
		}

		t2.test("resends on connect from the connector", async t3 => {
			const { control, connector, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			connector.emit("connect");
			await settle();
			t3.strictSame(requests().at(-1), ["TestEvent", "replace", -1]);
		});

		for (const event of ["drop", "close"] as const) {
			t2.test(`marks the subscriber unsynced on ${event}`, async t3 => {
				const { control, subscriptions } = connected();
				subscriptions.handle(TestEvent);
				const subscriber = new lib.EventSubscriber(TestEvent, control);
				const calls: unknown[] = [];
				subscriber.subscribe((e, synced) => { calls.push([e, synced]); });
				await settle();
				t3.equal(subscriber.synced, true);
				subscriber.handleConnectionEvent(event);
				t3.equal(subscriber.synced, false);
				t3.strictSame(calls.at(-1), [null, false]);
				subscriber.handleConnectionEvent(event);
				t3.equal(calls.length, 2, "notified once");
			});
		}

		t2.test("marks the subscriber unsynced on close from the connector", async t3 => {
			const { control, connector } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.synced = true;
			connector.emit("close");
			t3.equal(subscriber.synced, false);
		});
	});

	t1.test("handleAccountEvent()", async t2 => {
		t2.test("resends the subscription if subscribed", async t3 => {
			const { control, requests } = recorded();
			const callbacks = new lib.EventSubscriber(TestEvent, control);
			const filtered = new lib.EventSubscriber(MapEvent, control);
			callbacks.subscribe(() => {});
			filtered.addFilters("foo");
			callbacks.handleAccountEvent();
			filtered.handleAccountEvent();
			await settle();
			t3.strictSame(requests().slice(2), [["TestEvent", "replace", -1], ["MapEvent", "replace", -1, ["foo"]]]);
		});

		t2.test("sends nothing if not subscribed", async t3 => {
			const { control, sent } = recorded();
			new lib.EventSubscriber(TestEvent, control).handleAccountEvent();
			await settle();
			t3.strictSame(sent, []);
		});

		t2.test("sends once when the account is reported while connecting", async t3 => {
			const { control, connector, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			subscriber.handleAccountEvent();
			connector.emit("connect");
			await settle();
			t3.equal(requests().length, 2);
		});
	});

	t1.test("permitted", async t2 => {
		t2.test("sends nothing while not permitted", async t3 => {
			const { control, connector, sent } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control, undefined, () => false);
			subscriber.subscribe(() => {});
			subscriber.addFilters("foo");
			connector.emit("connect");
			subscriber.handleConnectionEvent("resume");
			subscriber.handleAccountEvent();
			await settle();
			t3.strictSame(sent, []);
		});

		t2.test("subscribes when the account becomes permitted", async t3 => {
			const { control, requests } = recorded();
			let permitted = false;
			const subscriber = new lib.EventSubscriber(TestEvent, control, undefined, () => permitted);
			subscriber.subscribe(() => {});
			permitted = true;
			subscriber.handleAccountEvent();
			await settle();
			t3.strictSame(requests(), [["TestEvent", "replace", -1]]);
		});
	});

	t1.test("_sendRequest()", async t2 => {
		t2.test("sends nothing when the connector is not valid", async t3 => {
			const { control, connector, sent } = recorded();
			Object.defineProperty(connector, "valid", { value: false });
			new lib.EventSubscriber(TestEvent, control).subscribe(() => {});
			await settle();
			t3.strictSame(sent, []);
		});

		t2.test("sends the time of the last update", async t3 => {
			const { control, requests } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.lastUpdatedMs = 1234;
			subscriber.subscribe(() => {});
			t3.strictSame(requests(), [["TestEvent", "subscribe", 1234]]);
		});

		t2.test("notifies synced when no updates were sent", async t3 => {
			const { control, respond } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const calls: unknown[] = [];
			subscriber.subscribe((event, synced) => { calls.push([event, synced]); });
			respond(false);
			await settle();
			t3.strictSame(calls, [[null, true]]);
			t3.equal(subscriber.synced, true);
		});

		t2.test("waits for the event when updates were sent", async t3 => {
			const { control, connector, respond } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const calls: unknown[] = [];
			subscriber.subscribe((event, synced) => { calls.push([event, synced]); });
			respond(true);
			await settle();
			t3.strictSame(calls, []);
			t3.equal(subscriber.synced, false);
			connector.emit("message", new lib.MessageEvent(2, controller, control1, "TestEvent"));
			t3.strictSame(calls, [[new TestEvent(), true]]);
			t3.equal(subscriber.synced, true);
		});

		t2.test("logs unexpected errors and stores them", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { control } = recorded();
			t3.capture(control, "sendTo", async () => { throw new Error("boom"); });
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const calls: unknown[] = [];
			subscriber.subscribe((event, synced) => { calls.push([event, synced]); });
			await settle();
			t3.match(errors.args(), [[/^Unexpected error updating TestEvent subscription:\nError: boom/]]);
			t3.match(subscriber.error, { message: "boom" });
			t3.strictSame(calls, [[null, false]]);
		});

		t2.test("does not log SessionLost", async t3 => {
			const errors = t3.capture(lib.logger, "error");
			const { control, connector } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			connector.emit("close");
			await settle();
			t3.strictSame(errors.args(), []);
			t3.type(subscriber.error, lib.SessionLost);
		});

		t2.test("ignores thrown values that are not errors", async t3 => {
			t3.capture(lib.logger, "error");
			const { control } = recorded();
			// eslint-disable-next-line prefer-promise-reject-errors
			t3.capture(control, "sendTo", () => Promise.reject("not an error"));
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.subscribe(() => {});
			await settle();
			t3.equal(subscriber.error, null);
			t3.equal(subscriber.synced, false);
		});

		t2.test("unsyncs on a permission error from the controller", async t3 => {
			t3.capture(lib.logger, "error");
			const { control, controllerLink, subscriptions } = connected();
			subscriptions.handle(StringPermissionEvent);
			let denied = false;
			t3.capture(controllerLink, "validatePermission", (message: any) => {
				if (denied) {
					// ControlConnection answers denied requests itself
					const err = new lib.PermissionError("Permission denied");
					controllerLink.connector.sendResponseError(lib.Link.errorToResponse(err, false), message.src);
					throw err;
				}
			});
			const subscriber = new lib.EventSubscriber(StringPermissionEvent, control);
			const calls: unknown[] = [];
			subscriber.subscribe((event, synced) => { calls.push([event, synced]); });
			await settle();
			t3.equal(subscriber.synced, true);
			denied = true;
			subscriber.handleAccountEvent();
			await settle();
			t3.equal(subscriber.synced, false);
			t3.strictSame(calls.at(-1), [null, false]);
			t3.type(subscriber.error, lib.PermissionError);
			t3.equal(lib.Link.errorName(subscriber.error!), "PermissionError");
		});

		t2.test("clears the error after a successful request", async t3 => {
			const { control, respond } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			subscriber.error = new Error("old");
			subscriber.subscribe(() => {});
			respond(false);
			await settle();
			t3.equal(subscriber.error, null);
		});
	});

	t1.test("getSnapshot()", async t2 => {
		t2.test("returns the same snapshot until the state changes", async t3 => {
			const { control } = recorded();
			const subscriber = new lib.EventSubscriber(TestEvent, control);
			const snap1 = subscriber.getSnapshot();
			t3.strictSame(snap1, [null, false, null]);
			t3.equal(subscriber.getSnapshot(), snap1);

			subscriber.lastUpdatedMs = 5;
			const snap2 = subscriber.getSnapshot();
			t3.not(snap2, snap1, "changes with lastUpdatedMs");

			subscriber.synced = true;
			const snap3 = subscriber.getSnapshot();
			t3.not(snap3, snap2, "changes with synced");
			t3.equal(snap3[1], true);

			subscriber.error = new Error("x");
			const snap4 = subscriber.getSnapshot();
			t3.not(snap4, snap3, "changes with error");
			t3.equal(snap4[2], subscriber.error);
			t3.equal(subscriber.getSnapshot(), snap4);
		});
	});
});

t.test("ValueSubscriber", async t1 => {
	function valueSetup() {
		const { control, connector } = recorded();
		const subscriber = new lib.ValueSubscriber(ValueEvent, control);
		const receive = (value: Item) => {
			connector.emit("message", new lib.MessageEvent(1, controller, control1, "ValueEvent", { value }));
		};
		return { subscriber, receive };
	}

	t1.test("_handleEvent()", async t2 => {
		t2.test("stores the value and its update time", async t3 => {
			const { subscriber, receive } = valueSetup();
			receive(item(1, 100));
			t3.strictSame(subscriber.value, item(1, 100));
			t3.equal(subscriber.lastUpdatedMs, 100);
			receive(item(1, 200));
			t3.equal(subscriber.value!.updatedAtMs, 200);
		});

		t2.test("does not move lastUpdatedMs back for an older value", async t3 => {
			const { subscriber, receive } = valueSetup();
			receive(item(1, 200));
			receive(item(1, 100));
			t3.equal(subscriber.lastUpdatedMs, 200);
		});
	});

	t1.test("getSnapshot()", async t2 => {
		const todo = "the base class makes the first snapshot before value is set";
		t2.test("returns null before a value is received", { todo }, async t3 => {
			const { subscriber } = valueSetup();
			t3.strictSame(subscriber.getSnapshot(), [null, false, null]);
		});

		t2.test("returns the value", async t3 => {
			const { subscriber, receive } = valueSetup();
			receive(item(1, 50));
			t3.strictSame(subscriber.getSnapshot(), [item(1, 50), false, null]);
		});

		t2.test("updates when the value changes in the same millisecond", { todo: snapshotTodo }, async t3 => {
			const { subscriber, receive } = valueSetup();
			receive(item(1, 50, { name: "a" }));
			subscriber.getSnapshot();
			receive(item(1, 50, { name: "b" }));
			t3.match(subscriber.getSnapshot()[0], { name: "b" });
		});
	});

	t1.test("receives values from the controller", async t2 => {
		const { control, subscriptions } = connected();
		subscriptions.handle(ValueEvent, async () => new ValueEvent(item(1, 10)) as any);
		const subscriber = new lib.ValueSubscriber(ValueEvent, control);
		subscriber.subscribe(() => {});
		await settle();
		t2.strictSame(subscriber.getSnapshot(), [item(1, 10), true, null]);
		subscriptions.broadcast(new ValueEvent(item(1, 20)) as any);
		t2.equal(subscriber.value!.updatedAtMs, 20);
	});
});

t.test("MapSubscriber", async t1 => {
	function mapSetup() {
		const { control, connector, requests } = recorded();
		const subscriber = new lib.MapSubscriber(MapEvent, control);
		const receive = (...updates: Item[]) => {
			connector.emit("message", new lib.MessageEvent(1, controller, control1, "MapEvent", { updates }));
		};
		return { subscriber, receive, connector, requests };
	}

	t1.test("_handleEvent()", async t2 => {
		t2.test("adds, updates and deletes values", async t3 => {
			const { subscriber, receive } = mapSetup();
			receive(item(1, 10), item(2, 20));
			t3.strictSame([...subscriber.values.keys()], [1, 2]);
			receive(item(1, 30), { ...item(2, 40), isDeleted: true });
			t3.strictSame([...subscriber.values], [[1, item(1, 30)]]);
		});

		t2.test("sets lastUpdatedMs to the newest update", async t3 => {
			const { subscriber, receive } = mapSetup();
			receive(item(1, 10), item(2, 50), item(3, 20));
			t3.equal(subscriber.lastUpdatedMs, 50);
			receive(item(1, 30));
			t3.equal(subscriber.lastUpdatedMs, 50);
		});

		t2.test("warns about changed content with the same timestamp", async t3 => {
			const warnings = t3.capture(lib.logger, "warn");
			const { receive } = mapSetup();
			receive(item(1, 10, { foo: "a" }));
			receive(item(1, 10, { foo: "a" }));
			t3.strictSame(warnings.args(), [], "identical updates are fine");
			receive(item(1, 10, { foo: "b" }));
			t3.strictSame(warnings.args(), [[
				"MapEvent contains update for value with id 1 that has an identical updatedAtMs timestamp " +
				"but differing content",
			]]);
		});
	});

	t1.test("getSnapshot()", async t2 => {
		t2.test("returns a copy that later events do not change", async t3 => {
			const { subscriber, receive } = mapSetup();
			receive(item(1, 10));
			const [snap1] = subscriber.getSnapshot();
			t3.strictSame(snap1, subscriber.values);
			t3.not(snap1, subscriber.values);
			receive(item(2, 20));
			const [snap2] = subscriber.getSnapshot();
			t3.equal(snap1.has(2), false);
			t3.equal(snap2.has(2), true);
		});

		t2.test("updates when a value changes in the same millisecond", { todo: snapshotTodo }, async t3 => {
			const { subscriber, receive } = mapSetup();
			receive(item(1, 10));
			subscriber.getSnapshot();
			receive(item(2, 10));
			t3.equal(subscriber.getSnapshot()[0].has(2), true);
		});
	});

	t1.test("handleConnectionEvent()", async t2 => {
		t2.test("fetches everything again on connect", async t3 => {
			const { subscriber, receive, connector, requests } = mapSetup();
			subscriber.subscribe(() => {});
			receive(item(1, 10));
			const [before] = subscriber.getSnapshot();
			connector.emit("connect");
			t3.equal(subscriber.values.size, 0);
			t3.equal(subscriber.lastUpdatedMs, -1);
			t3.not(subscriber.getSnapshot()[0], before);
			await settle();
			t3.strictSame(requests().at(-1), ["MapEvent", "replace", -1]);
		});

		t2.test("keeps values when a session is resumed", async t3 => {
			const { subscriber, receive } = mapSetup();
			receive(item(1, 10));
			subscriber.handleConnectionEvent("drop");
			subscriber.handleConnectionEvent("resume");
			t3.equal(subscriber.values.size, 1);
			t3.equal(subscriber.lastUpdatedMs, 10);
		});
	});

	t1.test("tracks values from the controller", async t2 => {
		const { control, subscriptions } = connected();
		let stored = [item(1, 10), item(2, 20)];
		subscriptions.handle(MapEvent, async request => new MapEvent(
			stored.filter(value => value.updatedAtMs > request.lastRequestTimeMs),
		) as any);
		const subscriber = new lib.MapSubscriber(MapEvent, control);
		subscriber.subscribe(() => {});
		await settle();
		t2.strictSame([...subscriber.values.keys()], [1, 2]);
		t2.equal(subscriber.synced, true);

		stored = [item(1, 10), { ...item(2, 30), isDeleted: true }];
		subscriptions.broadcast(new MapEvent([stored[1]]) as any);
		t2.strictSame([...subscriber.values.keys()], [1]);
		t2.equal(subscriber.lastUpdatedMs, 30);
	});
});
