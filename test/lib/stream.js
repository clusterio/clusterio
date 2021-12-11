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

	describe("class ReverseLineSplitter", function() {
		function createReverseSplitter(lines) {
			let stream = new libStream.ReverseLineSplitter({ readableObjectMode: true });
			stream.on("data", line => lines.push(line.toString("utf-8")));
			return stream;
		}

		it("should split three lines", function() {
			let lines = [];
			let ls = createReverseSplitter(lines);
			ls.write(Buffer.from("line 1\nline 2\nline 3\n"));
			ls.end();
			assert.deepEqual(lines, ["line 3", "line 2", "line 1"]);
		});
		it("should split three Windows line endings lines", function() {
			let lines = [];
			let ls = createReverseSplitter(lines);
			ls.write(Buffer.from("line 1\r\nline 2\r\nline 3\r\n"));
			ls.end();
			assert.deepEqual(lines, ["line 3", "line 2", "line 1"]);
		});
		it("should handle mixed line endings", function() {
			let lines = [];
			let ls = createReverseSplitter(lines);
			ls.write(Buffer.from("1\n\n2\r\n\r\n3\n4"));
			ls.end();
			assert.deepEqual(lines, ["4", "3", "", "2", "", "1"]);
		});
		it("should give the first line on .end()", function() {
			let lines = [];
			let ls = createReverseSplitter(lines);
			ls.write(Buffer.from("line a\nline b"));
			assert.deepEqual(lines, ["line b"]);
			ls.end();
			assert.deepEqual(lines, ["line b", "line a"]);
		});
		it("should handled partial lines", function() {
			let lines = [];
			let ls = createReverseSplitter(lines);
			ls.write(Buffer.from("part 3\n"));
			ls.write(Buffer.from(" part 2 "));
			ls.write(Buffer.from("part 1"));
			ls.end();
			assert.deepEqual(lines, ["part 1 part 2 part 3"]);
		});
	});

	describe("createReverseReadStream()", function() {
		it("should read chunks in a file in reverse", async function() {
			let content = "";
			for (let i = 0; i < 10; i++) { content += String(i).repeat(10); }
			await fs.outputFile(path.join("temp", "test", "reverse.txt"), content);
			let stream = await libStream.createReverseReadStream(
				path.join("temp", "test", "reverse.txt"),
				{ encoding: "utf8", highWaterMark: 10 }
			);
			let index = 9;
			stream.on("data", data => {
				assert.equal(data, String(index).repeat(10));
				index -= 1;
			});
			await events.once(stream, "end");
		});

		it("should reverse the lines of a file", async function() {
			let ws = fs.createWriteStream(path.join("temp", "test", "reverse.txt"));
			for (let i = 1; i < 100000; i++) {
				ws.write(Buffer.from(`${i}\n`));
			}
			ws.end();
			await events.once(ws, "finish");

			let lineStream = new libStream.ReverseLineSplitter({ readableObjectMode: true });
			let index = 99999;
			let rs = await libStream.createReverseReadStream(path.join("temp", "test", "reverse.txt"));
			lineStream.on("data", line => {
				let n = Number(line.toString());
				if (index !== n) {
					rs.destroy();
					assert.equal(n, index);
				}
				index -= 1;
			});
			rs.pipe(lineStream);
			await events.once(lineStream, "end");

			assert.equal(index, 0, "line check did not reach the end");
		});
	});
});
