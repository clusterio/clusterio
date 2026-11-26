import t from "tap";
import * as lib from "@clusterio/lib";

t.test("parse()", async t1 => {
	t1.test("parses keys at the root and in sections", async t2 => {
		t2.strictSame(
			lib.parse("root=1\n[a]\nx=2\n[b]\ny=3\n"),
			{ root: "1", a: { x: "2" }, b: { y: "3" } },
		);
	});
	t1.test("returns an empty object for empty input", async t2 => {
		t2.strictSame(lib.parse(""), {});
		t2.strictSame(lib.parse("\n\n"), {});
	});
	t1.test("ignores comments", async t2 => {
		t2.strictSame(lib.parse("# A comment\n; Another comment\nfoo=bar\n"), { foo: "bar" });
	});
	t1.test("ignores leading whitespace and trailing whitespace on headers", async t2 => {
		t2.strictSame(
			lib.parse("  # A comment  \n\n [spam] \t \n \tfoo=bar\n"),
			{ spam: { foo: "bar" } },
		);
	});
	t1.test("keeps whitespace inside headers, keys and values", async t2 => {
		t2.strictSame(
			lib.parse("[\t spam\t ]\nfoo =\t bar \n"),
			{ "\t spam\t ": { "foo ": "\t bar " } },
		);
	});
	t1.test("does not treat comment characters or = in values specially", async t2 => {
		t2.strictSame(
			lib.parse("[#;spam]\nfoo#;=#;bar=#;'\""),
			{ "#;spam": { "foo#;": "#;bar=#;'\"" } },
		);
	});
	t1.test("allows empty keys and values", async t2 => {
		t2.strictSame(lib.parse("=\nkey=\n"), { "": "", key: "" });
	});
	t1.test("handles Windows line endings", async t2 => {
		t2.strictSame(lib.parse("[spam]\r\nfoo=bar\r\n"), { spam: { foo: "bar" } });
	});
	t1.test("strips a byte order mark", async t2 => {
		t2.strictSame(lib.parse("﻿[spam]\nfoo=bar\n"), { spam: { foo: "bar" } });
	});
	t1.test("allows the same key in different sections", async t2 => {
		t2.strictSame(lib.parse("k=0\n[a]\nk=1\n[b]\nk=2\n"), { k: "0", a: { k: "1" }, b: { k: "2" } });
	});
	t1.test("does not treat inherited properties as duplicates", async t2 => {
		t2.strictSame(lib.parse("toString=1\n[a]\nconstructor=2\n"), { toString: "1", a: { constructor: "2" } });
	});
	t1.test("throws on an unterminated section header", async t2 => {
		t2.throws(() => lib.parse("[spam"), new Error("Unterminated section header on line 1"));
		t2.throws(() => lib.parse("a=b\n\n[spam] x"), new Error("Unterminated section header on line 3"));
	});
	t1.test("throws on a key without a value", async t2 => {
		t2.throws(() => lib.parse("key"), new Error("Missing value for key key on line 1"));
	});
	t1.test("throws on a duplicated section", async t2 => {
		t2.throws(() => lib.parse("[spam]\n[spam]\n"), new Error("Duplicated section [spam] on line 2"));
	});
	t1.test("throws on a section named like a root key", async t2 => {
		t2.throws(() => lib.parse("spam=1\n[spam]\n"), new Error("Duplicated section [spam] on line 2"));
	});
	t1.test("throws on a duplicated key", async t2 => {
		t2.throws(() => lib.parse("key=value\nkey=value\n"), new Error("Duplicated key key on line 2"));
		t2.throws(() => lib.parse("[s]\nkey=1\r\nkey=2\n"), new Error("Duplicated key key on line 3"));
	});
});

t.test("stringify()", async t1 => {
	t1.test("serializes to the reference output", async t2 => {
		const cases: [Record<string, string | Record<string, string>>, string][] = [
			[{}, ""],
			[{ foo: "bar" }, "foo=bar\n"],
			[{ foo: {} }, "[foo]\n"],
			[{ foo: { spam: "one", bar: "two" } }, "[foo]\nspam=one\nbar=two\n"],
			[{ a: { x: "1" }, b: { y: "2" } }, "[a]\nx=1\n\n[b]\ny=2\n"],
			[
				{ start: "alpha", foo: { spam: "one", bar: "two" }, end: "beta" },
				"start=alpha\nend=beta\n\n[foo]\nspam=one\nbar=two\n",
			],
			[{ "trail ": "\t tabs \t" }, "trail =\t tabs \t\n"],
			[{ "#;spam": { "foo#;": "#;bar=#;'\"" } }, "[#;spam]\nfoo#;=#;bar=#;'\"\n"],
		];
		for (const [input, expected] of cases) {
			t2.equal(lib.stringify(input), expected);
		}
	});
});

t.test("round trips through stringify() and parse()", async t1 => {
	const cases: Record<string, string | Record<string, string>>[] = [
		{},
		{ simple: "value" },
		{ section: { foo: "false", bar: "text" } },
		{ mixed: "root", section: { foo: "1", bar: "2" }, end: "value" },
		{ first: { foo: "1", bar: "2" }, second: { spam: "true" } },
		{ "\"#;[] ": " \"#;[] ", " #;\"[ ": { "\"#;[] ": " \"#;[ " } },
	];
	for (const expected of cases) {
		t1.strictSame(lib.parse(lib.stringify(expected)), expected);
	}
});
