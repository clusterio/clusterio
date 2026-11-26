import fs from "node:fs/promises";
import path from "node:path";
import stream from "node:stream";
import t from "tap";
import * as lib from "@clusterio/lib";

type Splitter = typeof lib.LineSplitter | typeof lib.ReverseLineSplitter;

// Write chunks to a new splitter and return the lines it pushes
function split(Splitter: Splitter, ...chunks: string[]) {
	const lines: string[] = [];
	const splitter = new Splitter({ readableObjectMode: true });
	splitter.on("data", line => lines.push(line.toString("utf-8")));
	for (const chunk of chunks) {
		splitter.write(Buffer.from(chunk));
	}
	splitter.end();
	return lines;
}

async function readAll(readable: stream.Readable) {
	const chunks: any[] = [];
	for await (const chunk of readable) {
		chunks.push(chunk);
	}
	return chunks;
}

t.test("LineSplitter", async t1 => {
	t1.test("_transform()", async t2 => {
		t2.test("splits lines", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "line 1\nline 2\nline 3\n"), ["line 1", "line 2", "line 3"]);
		});
		t2.test("removes Windows line endings", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "line 1\r\nline 2\r\nline 3\r\n"), ["line 1", "line 2", "line 3"]);
		});
		t2.test("handles mixed line endings", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "1\n\n2\r\n\r\n3\n4"), ["1", "", "2", "", "3", "4"]);
		});
		t2.test("keeps a lone carriage return", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "a\rb\n"), ["a\rb"]);
		});
		t2.test("joins lines split over chunks", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "part 1", " part 2 ", "part 3\n"), ["part 1 part 2 part 3"]);
		});
		t2.test("removes a carriage return split from its line feed", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "a\r", "\nb\r", "\n"), ["a", "b"]);
		});
		t2.test("pushes lines as they complete", async t3 => {
			const lines: string[] = [];
			const splitter = new lib.LineSplitter({ readableObjectMode: true });
			splitter.on("data", line => lines.push(line.toString()));
			splitter.write(Buffer.from("line a\nline b"));
			t3.strictSame(lines, ["line a"]);
			splitter.end();
			t3.strictSame(lines, ["line a", "line b"]);
		});
		t2.test("gives an empty line for a lone line feed", async t3 => {
			t3.strictSame(split(lib.LineSplitter, "\n"), [""]);
			t3.strictSame(split(lib.LineSplitter, "\r\n"), [""]);
		});
	});
	t1.test("_flush()", async t2 => {
		t2.test("pushes nothing for empty input", async t3 => {
			t3.strictSame(split(lib.LineSplitter), []);
			t3.strictSame(split(lib.LineSplitter, ""), []);
		});
	});
});

t.test("ReverseLineSplitter", async t1 => {
	t1.test("_transform()", async t2 => {
		t2.test("splits lines in reverse", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "line 1\nline 2\nline 3\n"), ["line 3", "line 2", "line 1"]);
		});
		t2.test("removes Windows line endings", async t3 => {
			t3.strictSame(
				split(lib.ReverseLineSplitter, "line 1\r\nline 2\r\nline 3\r\n"),
				["line 3", "line 2", "line 1"],
			);
		});
		t2.test("handles mixed line endings", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "1\n\n2\r\n\r\n3\n4"), ["4", "3", "", "2", "", "1"]);
		});
		t2.test("keeps a lone carriage return", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "x\na\rb\n"), ["a\rb", "x"]);
		});
		t2.test("joins lines split over chunks", async t3 => {
			t3.strictSame(
				split(lib.ReverseLineSplitter, "part 3\n", " part 2 ", "part 1"),
				["part 1 part 2 part 3"],
			);
		});
		t2.test("pushes lines as they complete", async t3 => {
			const lines: string[] = [];
			const splitter = new lib.ReverseLineSplitter({ readableObjectMode: true });
			splitter.on("data", line => lines.push(line.toString()));
			splitter.write(Buffer.from("line a\nline b"));
			t3.strictSame(lines, ["line b"]);
			splitter.end();
			t3.strictSame(lines, ["line b", "line a"]);
		});
	});
	t1.test("_flush()", async t2 => {
		t2.test("pushes nothing for empty input", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter), []);
		});
		t2.test("removes the line ending from the first line", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "ab\n"), ["ab"]);
			t3.strictSame(split(lib.ReverseLineSplitter, "ab\r\n"), ["ab"]);
		});
		t2.test("gives an empty line for a lone line feed", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "\n"), [""]);
		});
		t2.test("gives an empty line for a lone CRLF like LineSplitter", async t3 => {
			t3.strictSame(split(lib.ReverseLineSplitter, "\r\n"), split(lib.LineSplitter, "\r\n"));
		});
	});
	t1.test("gives the same lines as LineSplitter in reverse", async t2 => {
		const inputs = ["a\nb\nc", "a\r\n\r\nb\n", "\n\n", "a\r\nb\r\n", "\n\r\nx", "x\n\r\n"];
		for (const input of inputs) {
			t2.strictSame(
				split(lib.ReverseLineSplitter, input),
				split(lib.LineSplitter, input).reverse(),
				JSON.stringify(input),
			);
		}
	});
});

t.test("createReverseReadStream()", async t1 => {
	t1.test("reads chunks of a file from the end", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		let content = "";
		for (let i = 0; i < 10; i++) { content += String(i).repeat(10); }
		await fs.writeFile(file, content);
		const reverseStream = await lib.createReverseReadStream(file, { encoding: "utf8", highWaterMark: 10 });
		t2.strictSame(await readAll(reverseStream), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(i => String(i).repeat(10)));
	});
	t1.test("returns a short first chunk when the size is not a multiple", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		await fs.writeFile(file, "abcdefg");
		const reverseStream = await lib.createReverseReadStream(file, { encoding: "utf8", highWaterMark: 3 });
		t2.strictSame(await readAll(reverseStream), ["efg", "bcd", "a"]);
	});
	t1.test("accepts an encoding string as options", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		await fs.writeFile(file, "abc");
		const reverseStream = await lib.createReverseReadStream(file, "hex");
		t2.strictSame(await readAll(reverseStream), ["616263"]);
	});
	t1.test("gives Buffers without options", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		await fs.writeFile(file, "abc");
		const chunks = await readAll(await lib.createReverseReadStream(file));
		t2.equal(Buffer.concat(chunks).toString(), "abc");
		t2.ok(Buffer.isBuffer(chunks[0]));
	});
	t1.test("ends immediately for an empty file", async t2 => {
		const file = path.join(t2.testdir(), "empty.txt");
		await fs.writeFile(file, "");
		t2.strictSame(await readAll(await lib.createReverseReadStream(file)), []);
	});
	t1.test("rejects for a missing file", async t2 => {
		await t2.rejects(
			lib.createReverseReadStream(path.join(t2.testdir(), "missing.txt")),
			{ code: "ENOENT" },
		);
	});
	t1.test("closes the file when done", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		await fs.writeFile(file, "abc");
		const reverseStream = await lib.createReverseReadStream(file);
		const closed = new Promise<void>(resolve => reverseStream.once("close", () => resolve()));
		await readAll(reverseStream);
		await closed;
		t2.equal(reverseStream.closed, true);
	});
	t1.test("reverses the lines of a file with ReverseLineSplitter", async t2 => {
		const file = path.join(t2.testdir(), "reverse.txt");
		const lineCount = 20000;
		let content = "";
		for (let i = 1; i <= lineCount; i++) { content += `${i}\n`; }
		await fs.writeFile(file, content);

		const lineStream = new lib.ReverseLineSplitter({ readableObjectMode: true });
		(await lib.createReverseReadStream(file, { highWaterMark: 1000 })).pipe(lineStream);
		const lines = (await readAll(lineStream)).map(line => Number(line.toString()));
		t2.equal(lines.length, lineCount);
		t2.ok(lines.every((n, index) => n === lineCount - index), "lines are in reverse order");
	});
});
