import t from "tap";
import * as lib from "@clusterio/lib";

t.test("normalizeColor()", async t1 => {
	const nc = lib.normalizeColor;
	t1.test("keeps colours in the 0 to 1 range", async t2 => {
		t2.strictSame(nc({ r: 1, g: 0.2, b: 0.4, a: 0.8 }), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
		t2.strictSame(nc([1, 0.2, 0.4, 0.8]), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
	});
	t1.test("fills in missing components", async t2 => {
		t2.strictSame(nc({ r: 1, g: 0.2, b: 0.4 }), { r: 1, g: 0.2, b: 0.4, a: 1 });
		t2.strictSame(nc({ r: 1, b: 0.4 }), { r: 1, g: 0, b: 0.4, a: 1 });
		t2.strictSame(nc({ a: 0.4 }), { r: 0, g: 0, b: 0, a: 0.4 });
		t2.strictSame(nc({}), { r: 0, g: 0, b: 0, a: 1 });
		t2.strictSame(nc([1, 0.2, 0.4]), { r: 1, g: 0.2, b: 0.4, a: 1 });
	});
	t1.test("scales colours in the 0 to 255 range", async t2 => {
		t2.strictSame(nc({ r: 255, g: 51, b: 102, a: 204 }), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
		t2.strictSame(nc({ r: 255, g: 51, b: 102 }), { r: 1, g: 0.2, b: 0.4, a: 1 });
		t2.strictSame(nc({ r: 255, b: 102 }), { r: 1, g: 0, b: 0.4, a: 1 });
		t2.strictSame(nc({ a: 102 }), { r: 0, g: 0, b: 0, a: 0.4 });
		t2.strictSame(nc([255, 51, 102, 204]), { r: 1, g: 0.2, b: 0.4, a: 0.8 });
		t2.strictSame(nc([255, 51, 102]), { r: 1, g: 0.2, b: 0.4, a: 1 });
	});
	t1.test("scales every component when any is above 1", async t2 => {
		t2.strictSame(nc({ r: 0, g: 0, b: 51, a: 1 }), { r: 0, g: 0, b: 0.2, a: 1 / 255 });
		t2.strictSame(nc({ g: 255 }), { r: 0, g: 1, b: 0, a: 1 });
		t2.strictSame(nc({ b: 255 }), { r: 0, g: 0, b: 1, a: 1 });
	});
	t1.test("keeps 1 as the top of the 0 to 1 range", async t2 => {
		t2.strictSame(nc({ r: 1, g: 1, b: 1, a: 1 }), { r: 1, g: 1, b: 1, a: 1 });
	});
});

t.test("escapeString()", async t1 => {
	const cases: [string, string, string][] = [
		["backslashes", "\\a", "\\\\a"],
		["double quotes", '"a"', '\\"a\\"'],
		["single quotes", "'a'", "\\'a\\'"],
		["nul bytes", "a\0b", "a\\0b"],
		["newlines", "a\nb", "a\\nb"],
		["carriage returns", "a\rb", "a\\rb"],
		["all of them combined", "a\\b\"c'd\0e\nf\rg", "a\\\\b\\\"c\\'d\\0e\\nf\\rg"],
	];
	for (const [name, input, expected] of cases) {
		t1.test(`escapes ${name}`, async t2 => {
			t2.equal(lib.escapeString(input), expected);
		});
	}
	t1.test("escapes backslashes before the escapes it adds", async t2 => {
		t2.equal(lib.escapeString("\\n"), "\\\\n");
	});
	t1.test("leaves other text alone", async t2 => {
		t2.equal(lib.escapeString("plain text ©💣\t"), "plain text ©💣\t");
		t2.equal(lib.escapeString(""), "");
	});
});
