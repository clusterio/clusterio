"use strict";
const assert = require("assert").strict;
const hrtime = process.hrtime.bigint;

const lib = require("@clusterio/lib");


describe("lib/helpers", function() {
	describe("basicType()", function() {
		it("should return the expected values", function() {
			assert.equal(lib.basicType("s"), "string");
			assert.equal(lib.basicType(null), "null");
			assert.equal(lib.basicType(undefined), "undefined");
			assert.equal(lib.basicType([1, 2]), "array");
			assert.equal(lib.basicType(7), "number");
			assert.equal(lib.basicType({ a: 1 }), "object");
		});
	});

	describe("wait", function() {
		it("should wait the approximate amount of time given", async function() {
			let startNs = hrtime();
			await lib.wait(100);
			let duration = Number(hrtime() - startNs) / 1e6;

			// On windows the time waited is normally up to 15 ms late with outliers in the 20ms range.
			assert(duration > 90 && duration < 130, `duration (${duration}ms) not within (90-130)`);
		});
	});

	describe("timeout", function() {
		it("should return the result of an already resolved promise", async function() {
			assert.equal(await lib.timeout(Promise.resolve("value"), 10, "timeout"), "value");
		});
		it("should return the result of the promise if received before timeout", async function() {
			assert.equal(await lib.timeout(
				(async () => { await lib.wait(10); return "value"; })(), 20, "timeout"
			), "value");
		});
		it("should return the timeoutResult if not received before timeout", async function() {
			assert.equal(await lib.timeout(
				(async () => { await lib.wait(20); return "value"; })(), 10, "timeout"
			), "timeout");
		});
	});

	function parse(input, attributes) {
		const result = lib.parseSearchString(input, attributes);
		if (!result.issues.length) {
			return result.terms;
		}
		return result;
	}

	describe("parseSearchString()", function() {
		function word(value, opts = {}) {
			return { type: "word", value, ...opts };
		}
		function attr(name, value) {
			return { type: "attribute", name, value: typeof value === "string" ? word(value) : value };
		}
		it("should split words", function() {
			assert.deepEqual(parse(""), [].map(word));
			assert.deepEqual(parse("word"), ["word"].map(word));
			assert.deepEqual(parse("some words here"), ["some", "words", "here"].map(word));
		});
		it("should trim whitespace", function() {
			assert.deepEqual(parse("   "), [].map(word));
			assert.deepEqual(parse("word  "), ["word"].map(word));
			assert.deepEqual(parse("   some  words    here"), ["some", "words", "here"].map(word));
		});
		it("should parse negated words", function() {
			assert.deepEqual(parse("this -that"), [word("this"), word("that", { exclude: true })]);
			assert.deepEqual(parse("not-negated"), [word("not-negated")]);
		});
		it("should not split quoted words", function() {
			assert.deepEqual(parse('"some quoted words" here'), ["some quoted words", "here"].map(word));
			assert.deepEqual(parse('"a quoted string"'), ["a quoted string"].map(word));
			assert.deepEqual(parse('words and "a quoted string"'), ["words", "and", "a quoted string"].map(word));
		});
		it("should split on quotation mark", function() {
			assert.deepEqual(parse('"quoted"unquoted'), ["quoted", "unquoted"].map(word));
			assert.deepEqual(parse('"quoted""double"'), ["quoted", "double"].map(word));
			assert.deepEqual(parse('word"with"quote'), ["word", "with", "quote"].map(word));
			assert.deepEqual(
				parse('word-"with"-negation'),
				[word("word-"), word("with"), word("negation", { exclude: true })]
			);
		});
		it("should allow colons in quotes", function() {
			assert.deepEqual(parse('"word:value"'), ["word:value"].map(word));
		});
		it("should parse attribute:value", function() {
			assert.deepEqual(parse("author:Me", { author: "word" }), [attr("author", "Me")]);
			assert.deepEqual(parse("word author:Me", { author: "word" }), [word("word"), attr("author", "Me")]);
			assert.deepEqual(
				parse("author:Me and author:You", { author: "word" }),
				[attr("author", "Me"), word("and"), attr("author", "You")]
			);
			assert.deepEqual(
				parse("author:Me"),
				{
					terms: [word("Me")],
					issues: ['Unregonized attribute "author", use quotes to escape colons'],
				}
			);
			assert.deepEqual(
				parse("constructor:value"),
				{
					terms: [word("value")],
					issues: ['Unregonized attribute "constructor", use quotes to escape colons'],
				}
			);
		});
		it("should throw on bad attribute format", function() {
			assert.throws(
				() => parse("author:Me", { author: "bad" }),
				new Error("Bad attribute format bad for author")
			);
		});
		it("should ignore attribute case", function() {
			assert.deepEqual(parse("Author:Me", { author: "word" }), [attr("author", "Me")]);
			assert.deepEqual(parse("AUTHOR:Me", { author: "word" }), [attr("author", "Me")]);
			assert.deepEqual(parse("auThOR:Me", { author: "word" }), [attr("author", "Me")]);
		});
		it("should parse partial inputs", function() {
			assert.deepEqual(parse("-"), [word("", { exclude: true })]);
			assert.deepEqual(parse('"'), [""].map(word));
			assert.deepEqual(parse('"word'), ["word"].map(word));
			assert.deepEqual(parse("author:", { author: "word" }), [attr("author", "")]);
			assert.deepEqual(parse("author:-", { author: "word" }), [attr("author", word("", { exclude: true }))]);
		});
	});
	describe("wordMatches()", function() {
		const match = lib.wordMatches;
		it("should match any inputs", function() {
			assert(match(parse("word")[0], "a word in a string"), "one text");
			assert(!match(parse("word")[0], "a string without"), "one text no match");
			assert(match(parse("word")[0], "no match", "no things", "a word", "bad text", ""), "five text");
			assert(!match(parse("unword")[0], "no match", "no things", "a word", "bad text", ""), "five text no match");
		});
		it("should invert match if using exclude", function() {
			assert(!match(parse("-word")[0], "a word in a string"), "one text");
			assert(match(parse("-word")[0], "a string without"), "one text no match");
			assert(!match(parse("-word")[0], "no match", "no things", "a word", "bad text", ""), "five text");
			assert(match(parse("-unword")[0], "no match", "no things", "a word", "bad text", ""), "five text no match");
		});
		it("should throw on bad input", function() {
			assert.throws(
				() => match(parse("attr:value", { attr: "word" })[0], "a string"),
				new Error("wordMatches: parameter is not a word"),
			);
		});
	});
});
