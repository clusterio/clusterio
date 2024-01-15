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

	describe("class AsyncSerialMergingCallback", function() {
		let started;
		let ended;
		let merger;
		beforeEach(function() {
			started = 0;
			ended = 0;
			merger = new lib.AsyncSerialMergingCallback(
				() => new Promise(resolve => {
					started += 1;
					process.nextTick(() => {
						ended += 1;
						resolve();
					});
				})
			);
		});
		it("should await the callback when invoked", async function() {
			await merger.invoke();
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 1, "incorrect ended count");
		});
		it("should immediately call the callback", async function() {
			let promise = merger.invoke();
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 0, "incorrect ended count");
			await promise;
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 1, "incorrect ended count");
		});
		it("should call the callback twice if invoked in twice in paralell", async function() {
			await Promise.all([
				merger.invoke(),
				merger.invoke(),
			]);
			assert.equal(started, 2, "incorrect started count");
			assert.equal(ended, 2, "incorrect ended count");
		});
		it("should call the callback twice if invoked many times in paralell", async function() {
			await Promise.all([
				merger.invoke(),
				merger.invoke(),
				merger.invoke(),
				merger.invoke(),
			]);
			assert.equal(started, 2, "incorrect started count");
			assert.equal(ended, 2, "incorrect ended count");
		});
		it("should serialise calls", async function() {
			let events = [];
			await Promise.all([
				merger.invoke().then(() => { events.push(1); }),
				merger.invoke().then(() => { events.push(2); }),
				merger.invoke().then(() => { events.push(3); }),
				merger.invoke().then(() => { events.push(4); }),
			]);
			assert.deepEqual(events, [1, 2, 3, 4]);
		});
	});

	describe("class AsyncSerialCallback", function() {
		let started;
		let ended;
		let serialiser;
		beforeEach(function() {
			started = 0;
			ended = 0;
			serialiser = new lib.AsyncSerialCallback(
				(input) => new Promise((resolve, reject) => {
					started += 1;
					process.nextTick(() => {
						ended += 1;
						if (input !== 99) {
							resolve(input);
						} else {
							reject(new Error("99"));
						}
					});
				})
			);
		});
		it("should await the callback when invoked", async function() {
			await serialiser.invoke();
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 1, "incorrect ended count");
		});
		it("should return the result of the callback", async function() {
			const id = await serialiser.invoke(42);
			assert.equal(id, 42, "returned result not passed");
		});
		it("should immediately call the callback", async function() {
			let promise = serialiser.invoke();
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 0, "incorrect ended count");
			await promise;
			assert.equal(started, 1, "incorrect started count");
			assert.equal(ended, 1, "incorrect ended count");
		});
		it("should call the callback twice if invoked in twice in paralell", async function() {
			await Promise.all([
				serialiser.invoke(),
				serialiser.invoke(),
			]);
			assert.equal(started, 2, "incorrect started count");
			assert.equal(ended, 2, "incorrect ended count");
		});
		it("should call the callback many if invoked many times in paralell", async function() {
			await Promise.all([
				serialiser.invoke(),
				serialiser.invoke(),
				serialiser.invoke(),
				serialiser.invoke(),
			]);
			assert.equal(started, 4, "incorrect started count");
			assert.equal(ended, 4, "incorrect ended count");
		});
		it("should serialise calls", async function() {
			let events = [];
			let calls = await Promise.all([
				serialiser.invoke(11).then((res) => { events.push(1); return res; }),
				serialiser.invoke(12).then((res) => { events.push(2); return res; }),
				serialiser.invoke(13).then((res) => { events.push(3); return res; }),
				serialiser.invoke(14).then((res) => { events.push(4); return res; }),
			]);
			assert.deepEqual(events, [1, 2, 3, 4]);
			assert.deepEqual(calls, [11, 12, 13, 14]);
		});
		it("should forward rejections", async function() {
			await assert.rejects(serialiser.invoke(99), new Error("99"));
		});
		it("should handle queued rejections", async function() {
			let events = [];
			let calls = await Promise.allSettled([
				serialiser.invoke(11).then((res) => { events.push(1); return res; }),
				serialiser.invoke(99).then((res) => { events.push(2); return res; }),
				serialiser.invoke(13).then((res) => { events.push(3); return res; }),
				serialiser.invoke(14).then((res) => { events.push(4); return res; }),
			]);
			assert.deepEqual(events, [1, 3, 4]);
			assert.deepEqual(calls, [
				{ status: "fulfilled", value: 11 },
				{ status: "rejected", reason: new Error("99") },
				{ status: "fulfilled", value: 13 },
				{ status: "fulfilled", value: 14 },
			]);
		});
	});

	describe("formatBytes()", function() {
		it("should format whole number of base unit bytes", function() {
			assert.equal(lib.formatBytes(100), "100\u{A0}Bytes");
			assert.equal(lib.formatBytes(100e3), "100\u{A0}kB");
			assert.equal(lib.formatBytes(100e6), "100\u{A0}MB");
			assert.equal(lib.formatBytes(100e9), "100\u{A0}GB");
			assert.equal(lib.formatBytes(100e12), "100\u{A0}TB");
			assert.equal(lib.formatBytes(100, false), "100\u{A0}Bytes");
			assert.equal(lib.formatBytes(100 * 2**10, false), "100\u{A0}kiB");
			assert.equal(lib.formatBytes(100 * 2**20, false), "100\u{A0}MiB");
			assert.equal(lib.formatBytes(100 * 2**30, false), "100\u{A0}GiB");
			assert.equal(lib.formatBytes(100 * 2**40, false), "100\u{A0}TiB");
		});
		it("should format with 3 significant digits fractional number of base unit bytes", function() {
			// 1 digits base and 2 digit fraction
			assert.equal(lib.formatBytes(1.234e3), "1.23\u{A0}kB");
			assert.equal(lib.formatBytes(1.234e6), "1.23\u{A0}MB");
			assert.equal(lib.formatBytes(1.234e9), "1.23\u{A0}GB");
			assert.equal(lib.formatBytes(1.234e12), "1.23\u{A0}TB");
			assert.equal(lib.formatBytes(1.234 * 2**10, "binary"), "1.23\u{A0}kiB");
			assert.equal(lib.formatBytes(1.234 * 2**20, "binary"), "1.23\u{A0}MiB");
			assert.equal(lib.formatBytes(1.234 * 2**30, "binary"), "1.23\u{A0}GiB");
			assert.equal(lib.formatBytes(1.234 * 2**40, "binary"), "1.23\u{A0}TiB");
			// 2 digits base and 1 digit fraction
			assert.equal(lib.formatBytes(12.34e3), "12.3\u{A0}kB");
			assert.equal(lib.formatBytes(12.34e6), "12.3\u{A0}MB");
			assert.equal(lib.formatBytes(12.34e9), "12.3\u{A0}GB");
			assert.equal(lib.formatBytes(12.34e12), "12.3\u{A0}TB");
			assert.equal(lib.formatBytes(12.34 * 2**10, "binary"), "12.3\u{A0}kiB");
			assert.equal(lib.formatBytes(12.34 * 2**20, "binary"), "12.3\u{A0}MiB");
			assert.equal(lib.formatBytes(12.34 * 2**30, "binary"), "12.3\u{A0}GiB");
			assert.equal(lib.formatBytes(12.34 * 2**40, "binary"), "12.3\u{A0}TiB");
			// 3 digits base and no fraction
			assert.equal(lib.formatBytes(123.4e3), "123\u{A0}kB");
			assert.equal(lib.formatBytes(123.4e6), "123\u{A0}MB");
			assert.equal(lib.formatBytes(123.4e9), "123\u{A0}GB");
			assert.equal(lib.formatBytes(123.4e12), "123\u{A0}TB");
			assert.equal(lib.formatBytes(123.4 * 2**10, "binary"), "123\u{A0}kiB");
			assert.equal(lib.formatBytes(123.4 * 2**20, "binary"), "123\u{A0}MiB");
			assert.equal(lib.formatBytes(123.4 * 2**30, "binary"), "123\u{A0}GiB");
			assert.equal(lib.formatBytes(123.4 * 2**40, "binary"), "123\u{A0}TiB");
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
	describe("parseRanges()", function() {
		function range(input, min=1, max=10) {
			return [...lib.parseRanges(input, min, max)];
		}
		function expectedRange(start, end) {
			const items = new Set();
			for (let i = start; i <= end; i++) {
				items.add(i);
			}
			return [...items];
		}
		it("should parse numbers separated by spaces and or commas", function() {
			assert.deepEqual(range("1"), [1]);
			assert.deepEqual(range(" 1"), [1]);
			assert.deepEqual(range("1 "), [1]);
			assert.deepEqual(range(" 1 "), [1]);
			assert.deepEqual(range("1 2"), [1, 2]);
			assert.deepEqual(range("1, 2"), [1, 2]);
			assert.deepEqual(range("1 , 2"), [1, 2]);
			assert.deepEqual(range(" 1 2 "), [1, 2]);
		});
		it("should parse ranges", function() {
			assert.deepEqual(range("1-4"), [1, 2, 3, 4]);
			assert.deepEqual(range(" 1-4 "), [1, 2, 3, 4]);
			assert.deepEqual(range(" 1 - 4 "), [1, 2, 3, 4]);
			assert.deepEqual(range("1- 4"), [1, 2, 3, 4]);
			assert.deepEqual(range("1 -4"), [1, 2, 3, 4]);
			assert.deepEqual(range(" 1, 2-4"), [1, 2, 3, 4]);
			assert.deepEqual(range("4-1"), [1, 2, 3, 4]);
		});
		it("should ignore duplicates in ranges", function() {
			assert.deepEqual(range("1, 2, 2, 2"), [1, 2]);
			assert.deepEqual(range("1-4, 3, 4"), [1, 2, 3, 4]);
			assert.deepEqual(range("3, 1-4"), [3, 1, 2, 4]);
		});
		it("should throw on bad input", function() {
			assert.throws(() => range("1-"), new Error('Expected digit but got end of input while parsing "1-"'));
			assert.throws(() => range("a1-4"), new Error('Expected digit but got \'a\' at pos 0 while parsing "a1-4"'));
			assert.throws(() => range("1a-4"), new Error('Expected digit but got \'a\' at pos 1 while parsing "1a-4"'));
			assert.throws(() => range("1-a4"), new Error('Expected digit but got \'a\' at pos 2 while parsing "1-a4"'));
			assert.throws(() => range("1-4a"), new Error('Expected digit but got \'a\' at pos 3 while parsing "1-4a"'));
		});
		it("should throw if out of range", function() {
			assert.throws(() => range("0"), new Error("value 0 is below the minimum value 1"));
			assert.throws(() => range("110"), new Error("value 110 is above the maximum value 10"));
			assert.throws(() => range("1-999"), new Error("end of range 1-999 is above the maximum value 10"));
			assert.throws(() => range("0-1"), new Error("start of range 0-1 is below the minimum value 1"));
		});
		it("should handle 16-bit ranges", function() {
			assert.deepEqual(range("1-65535", 1, 2**16 - 1), expectedRange(1, 2**16 - 1));
			assert.deepEqual(range("20000-20002", 1, 2**16 - 1), [20000, 20001, 20002]);
		});
	});
});
