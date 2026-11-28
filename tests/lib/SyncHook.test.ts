import t from "tap";
import * as lib from "@clusterio/lib";

t.test("SyncHook", async t1 => {
	t1.test("size and attached", async t2 => {
		t2.test("track attached handlers in order", async t3 => {
			const hook = new lib.SyncHook<number>();
			t3.equal(hook.size, 0);
			t3.strictSame([...hook.attached], []);
			hook.attach("alpha", value => value);
			hook.attach("beta", value => value);
			t3.equal(hook.size, 2);
			t3.strictSame([...hook.attached], ["alpha", "beta"]);
		});
	});

	t1.test("attach()", async t2 => {
		t2.test("rejects duplicate handler names", async t3 => {
			const hook = new lib.SyncHook<number>();
			hook.attach("alpha", value => value + 1);
			t3.throws(
				() => hook.attach("alpha", value => value),
				new Error("Handler with name alpha is already attached"),
			);
			t3.equal(hook.reduce(0), 1, "keeps the first handler");
		});
	});

	t1.test("detach()", async t2 => {
		t2.test("removes the named handler", async t3 => {
			const hook = new lib.SyncHook<string[]>();
			hook.attach("alpha", value => [...value, "alpha"]);
			hook.attach("beta", value => [...value, "beta"]);
			hook.detach("alpha");
			t3.strictSame(hook.reduce([]), ["beta"]);
		});
		t2.test("does nothing for unknown names", async t3 => {
			const hook = new lib.SyncHook<number>();
			hook.attach("alpha", value => value);
			hook.detach("missing");
			t3.strictSame([...hook.attached], ["alpha"]);
		});
	});

	t1.test("clear()", async t2 => {
		t2.test("removes all handlers", async t3 => {
			const hook = new lib.SyncHook<number>();
			hook.attach("alpha", value => value + 1);
			hook.attach("beta", value => value + 1);
			hook.clear();
			t3.equal(hook.size, 0);
			t3.equal(hook.reduce(0), 0);
		});
	});

	t1.test("reduce()", async t2 => {
		t2.test("passes the value through handlers in attach order", async t3 => {
			const hook = new lib.SyncHook<string[]>();
			hook.attach("alpha", value => [...value, "alpha"]);
			hook.attach("beta", value => [...value, "beta"]);
			t3.strictSame(hook.reduce(["start"]), ["start", "alpha", "beta"]);
		});
		t2.test("returns the value unchanged with no handlers", async t3 => {
			const value = {};
			t3.equal(new lib.SyncHook<object>().reduce(value), value);
		});
		t2.test("rethrows errors as a PluginError named after the handler", async t3 => {
			const hook = new lib.SyncHook<number>();
			const original = new Error("failed");
			let betaCalled = false;
			hook.attach("alpha", () => { throw original; });
			hook.attach("beta", value => { betaCalled = true; return value; });
			const err = t3.throws(() => hook.reduce(1), new lib.PluginError("alpha", original)) as lib.PluginError;
			t3.equal(err.pluginName, "alpha");
			t3.equal(err.original, original);
			t3.equal(betaCalled, false, "stops at the failing handler");
		});
		t2.test("wraps thrown values that are not errors", async t3 => {
			const hook = new lib.SyncHook<number>();
			hook.attach("alpha", () => { throw "plain"; }); // eslint-disable-line no-throw-literal
			const err = t3.throws(() => hook.reduce(1)) as lib.PluginError;
			t3.equal(err.pluginName, "alpha");
			t3.ok(err.original instanceof Error);
			t3.equal(err.original.message, "plain");
			t3.equal(err.message, "PluginError: plain");
		});
	});
});
