"use strict";
const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const path = require("path");

const libStream = require("@clusterio/lib/stream");


describe("lib/stream", function() {
	describe("class LineSplitter", function() {
		function createSplitter(lines) {
			let stream = new libStream.LineSplitter({ readableObjectMode: true });
			stream.on("data", line => lines.push(line.toString("utf-8")));
			return stream;
		}

		it("should split three lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.write(Buffer.from("line 1\nline 2\nline 3\n"));
			ls.end();
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should split three Windows line endings lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.write(Buffer.from("line 1\r\nline 2\r\nline 3\r\n"));
			ls.end();
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should handle mixed line endings", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.write(Buffer.from("1\n\n2\r\n\r\n3\n4"));
			ls.end();
			assert.deepEqual(lines, ["1", "", "2", "", "3", "4"]);
		});
		it("should give the last non-terminated line on .end()", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.write(Buffer.from("line a\nline b"));
			assert.deepEqual(lines, ["line a"]);
			ls.end();
			assert.deepEqual(lines, ["line a", "line b"]);
		});
		it("should handled partial lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.write(Buffer.from("part 1"));
			ls.write(Buffer.from(" part 2 "));
			ls.write(Buffer.from("part 3\n"));
			ls.end();
			assert.deepEqual(lines, ["part 1 part 2 part 3"]);
		});
	});
});
