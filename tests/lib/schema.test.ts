import t from "tap";
import * as lib from "@clusterio/lib";

const schema = {
	type: "object",
	properties: { a: { type: "integer" } },
	required: ["a"],
} as any;

t.test("compile()", async t1 => {
	t1.test("returns a validator", async t2 => {
		const validate = lib.compile<{ a: number }>(schema);
		t2.equal(validate({ a: 1 }), true);
		t2.equal(validate({ a: "1" }), false);
		t2.match(validate.errors, [{ instancePath: "/a", keyword: "type" }]);
	});
	t1.test("compiles straight away without a global object", async t2 => {
		t2.intercept(globalThis, "global", { value: undefined });
		t2.throws(() => lib.compile({ type: "nonsense" } as any), { message: /schema is invalid/ });
	});
	t1.test("defers compiling when lazySchemaCompilation is set", async t2 => {
		t2.intercept(globalThis as any, "lazySchemaCompilation", { value: true });
		const validate = lib.compile({ type: "nonsense" } as any);
		t2.throws(() => validate({}), { message: /schema is invalid/ }, "error comes on first use");
	});
	t1.test("lazy validator compiles once and passes on errors", async t2 => {
		t2.intercept(globalThis as any, "lazySchemaCompilation", { value: true });
		const validate = lib.compile<{ a: number }>(schema);
		t2.equal(validate.errors, undefined);
		t2.equal(validate({ a: "1" }), false);
		t2.match(validate.errors, [{ instancePath: "/a", keyword: "type" }]);
		t2.equal(validate({ a: 1 }), true);
		t2.equal(validate.errors, null);
	});
});
