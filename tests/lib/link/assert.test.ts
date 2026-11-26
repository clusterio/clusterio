import t from "tap";
import { assert } from "@clusterio/lib/dist/node/src/link/assert.js";

t.test("assert()", async t1 => {
	t1.test("returns for truthy values", async t2 => {
		for (const value of [true, 1, "a", {}, []]) {
			t2.doesNotThrow(() => assert(value));
		}
	});
	t1.test("throws for falsy values", async t2 => {
		for (const value of [false, 0, "", null, undefined, NaN]) {
			t2.throws(() => assert(value), new Error("Assertion failed"));
		}
	});
});
