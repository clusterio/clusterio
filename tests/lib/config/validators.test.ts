import t from "tap";
import * as lib from "@clusterio/lib";

const validators = lib.Config.validators;

t.test("validators", async t1 => {
	t1.test("all()", async t2 => {
		t2.test("runs every validator in order with the value and config", async t3 => {
			const calls: unknown[][] = [];
			const config = {};
			const combined = validators.all(
				(value: string, c: object) => { calls.push(["a", value, c]); },
				(value: string, c: object) => { calls.push(["b", value, c]); },
			);
			combined("value", config);
			t3.strictSame(calls, [["a", "value", config], ["b", "value", config]]);
		});
		t2.test("stops at the first validator that throws", async t3 => {
			const calls: string[] = [];
			const combined = validators.all(
				() => { calls.push("a"); throw new Error("failure"); },
				() => { calls.push("b"); },
			);
			t3.throws(() => combined("value", {}), new Error("failure"));
			t3.strictSame(calls, ["a"]);
		});
	});

	t1.test("optional()", async t2 => {
		t2.test("skips the validator for null", async t3 => {
			const wrapped = validators.optional(validators.greaterThanZero);
			t3.doesNotThrow(() => wrapped(null, {}));
		});
		t2.test("runs the validator for other values", async t3 => {
			const wrapped = validators.optional(validators.greaterThanZero);
			t3.doesNotThrow(() => wrapped(1, {}));
			t3.throws(() => wrapped(0, {}), new Error("Value must be greater than 0"));
		});
	});

	t1.test("greaterThan()", async t2 => {
		t2.test("accepts values above the minimum", async t3 => {
			t3.doesNotThrow(() => validators.greaterThan(5)(5.5));
		});
		t2.test("rejects the minimum and below", async t3 => {
			const validator = validators.greaterThan(5);
			t3.throws(() => validator(5), new Error("Value must be greater than 5"));
			t3.throws(() => validator(-5), new Error("Value must be greater than 5"));
		});
	});

	t1.test("greaterThanZero()", async t2 => {
		t2.test("accepts positive and rejects zero", async t3 => {
			t3.doesNotThrow(() => validators.greaterThanZero(0.1));
			t3.throws(() => validators.greaterThanZero(0), new Error("Value must be greater than 0"));
		});
	});

	t1.test("greaterThanEqual()", async t2 => {
		t2.test("accepts the minimum and above", async t3 => {
			const validator = validators.greaterThanEqual(5);
			t3.doesNotThrow(() => validator(5));
			t3.doesNotThrow(() => validator(6));
		});
		t2.test("rejects values below the minimum", async t3 => {
			t3.throws(
				() => validators.greaterThanEqual(5)(4),
				new Error("Value must be greater than or equal to 5"),
			);
		});
	});

	t1.test("greaterThanEqualZero()", async t2 => {
		t2.test("accepts zero and rejects negative values", async t3 => {
			t3.doesNotThrow(() => validators.greaterThanEqualZero(0));
			t3.throws(() => validators.greaterThanEqualZero(-1), Error);
		});
	});

	t1.test("integer()", async t2 => {
		t2.test("accepts integers", async t3 => {
			t3.doesNotThrow(() => validators.integer(-3));
		});
		t2.test("rejects fractions and non finite numbers", async t3 => {
			t3.throws(() => validators.integer(1.5), new Error("Value must be an integer"));
			t3.throws(() => validators.integer(Infinity), new Error("Value must be an integer"));
			t3.throws(() => validators.integer(NaN), new Error("Value must be an integer"));
		});
	});

	t1.test("filePath()", async t2 => {
		t2.test("accepts relative and absolute paths", async t3 => {
			t3.doesNotThrow(() => validators.filePath("dir/file.txt"));
			t3.doesNotThrow(() => validators.filePath("/absolute/path"));
		});
		t2.test("rejects values path.resolve cannot handle", async t3 => {
			t3.throws(
				() => validators.filePath(null as unknown as string),
				{ message: /^Value must be a valid path: The "paths\[0\]" argument must be of type string/ },
			);
		});
	});
});
