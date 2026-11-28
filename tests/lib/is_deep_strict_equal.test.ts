// The browser variant must behave like the node variant, so every case runs against both.
import t from "tap";
import browserIsDeepStrictEqual from "@clusterio/lib/dist/browser/src/is_deep_strict_equal.browser.js";
import nodeIsDeepStrictEqual from "@clusterio/lib/dist/node/src/is_deep_strict_equal.node.js";

const variants = [["node", nodeIsDeepStrictEqual], ["browser", browserIsDeepStrictEqual]] as const;

type Case = [name: string, a: unknown, b: unknown, equal: boolean];

// Values lib compares: config values, JSON data and data classes holding Maps and Sets.
const cases: Case[] = [
	["the same primitive", 1, 1, true],
	["different primitives", 1, 2, false],
	["a number and its string", 1, "1", false],
	["null and undefined", null, undefined, false],
	["null and an empty object", null, {}, false],
	["NaN and NaN", NaN, NaN, true],
	["equal nested objects", { a: [1, { b: "c" }], d: null }, { d: null, a: [1, { b: "c" }] }, true],
	["objects with a different value", { a: { b: 1 } }, { a: { b: 2 } }, false],
	["objects with a different key", { a: 1 }, { b: 1 }, false],
	["an object with an extra key", { a: 1 }, { a: 1, b: 2 }, false],
	["a key set to undefined and a missing key", { a: undefined }, {}, false],
	["equal arrays", [1, "a", [true]], [1, "a", [true]], true],
	["arrays in a different order", [1, 2], [2, 1], false],
	["arrays of different length", [1], [1, 1], false],
	["an array and an object with the same keys", [1], { 0: 1 }, false],
	["instances of different classes", new (class A { x = 1; })(), new (class B { x = 1; })(), false],
	["equal class instances", new URL("http://a/"), new URL("http://a/"), true],
	["equal Maps", new Map([["a", { b: 1 }]]), new Map([["a", { b: 1 }]]), true],
	["Maps with a different value", new Map([["a", { b: 1 }]]), new Map([["a", { b: 2 }]]), false],
	["Maps with a different key", new Map([["a", 1]]), new Map([["b", 1]]), false],
	["Maps of different size", new Map([["a", 1]]), new Map(), false],
	["equal Sets", new Set(["a", "b"]), new Set(["b", "a"]), true],
	["Sets with a different member", new Set(["a"]), new Set(["b"]), false],
	["Sets of different size", new Set(["a"]), new Set(), false],
	["equal Dates", new Date(1000), new Date(1000), true],
	["different Dates", new Date(1000), new Date(2000), false],
	["equal RegExps", /a/g, /a/g, true],
	["RegExps with different flags", /a/g, /a/i, false],
	["equal typed arrays", new Uint8Array([1, 2]), new Uint8Array([1, 2]), true],
	["different typed arrays", new Uint8Array([1, 2]), new Uint8Array([1, 3]), false],
	["typed arrays of different types", new Uint8Array([1]), new Int8Array([1]), false],
	["Errors with different messages", new Error("a"), new Error("b"), false],
];

// Inputs where fast-deep-equal gives a different answer than util.isDeepStrictEqual.
// lib never compares values like these, so only the node variant is held to them.
const divergentCases: [...Case, reason: string][] = [
	["0 and -0", 0, -0, false, "fast-deep-equal uses === for primitives"],
	["Sets with equal object members", new Set([{ a: 1 }]), new Set([{ a: 1 }]), true,
		"fast-deep-equal compares Set members by reference"],
	["objects with different symbol keys", { [Symbol.for("a")]: 1 }, { [Symbol.for("a")]: 2 }, false,
		"fast-deep-equal ignores symbol keys"],
	["a sparse array and an array of undefined", new Array(1), [undefined], false,
		"fast-deep-equal does not check for holes"],
	["objects that differ outside of toString()",
		{ a: 1, toString() { return "x"; } }, { a: 2, toString() { return "x"; } }, false,
		"fast-deep-equal compares only toString() when it is overridden"],
];

t.test("isDeepStrictEqual()", async t1 => {
	for (const [name, isDeepStrictEqual] of variants) {
		t1.test(name, async t2 => {
			for (const [caseName, a, b, equal] of cases) {
				t2.test(`${equal ? "accepts" : "rejects"} ${caseName}`, async t3 => {
					t3.equal(isDeepStrictEqual(a, b), equal);
					t3.equal(isDeepStrictEqual(b, a), equal, "symmetric");
				});
			}
		});
	}
	t1.test("differences between the variants", async t2 => {
		for (const [caseName, a, b, equal, reason] of divergentCases) {
			t2.test(caseName, async t3 => {
				t3.equal(nodeIsDeepStrictEqual(a, b), equal);
				t3.equal(browserIsDeepStrictEqual(a, b), !equal, reason);
			});
		}
		t2.test("objects without a prototype", async t3 => {
			const a = Object.assign(Object.create(null), { x: 1 });
			const b = Object.assign(Object.create(null), { x: 1 });
			t3.equal(nodeIsDeepStrictEqual(a, b), true);
			t3.throws(() => browserIsDeepStrictEqual(a, b), TypeError, "fast-deep-equal calls the missing valueOf()");
		});
	});
});
