import fs from "node:fs/promises";
import path from "node:path";
import stream from "node:stream";
import t from "tap";
import * as lib from "@clusterio/lib";

// sha1 of "hello world\n"
const helloHash = "22596363b3de40b06f981fb85d82312e8c0ed511";
// sha1 of no bytes
const emptyHash = "da39a3ee5e6b4b0d3255bfef95601890afd80709";

t.test("hashStream()", async t1 => {
	t1.test("hashes the bytes of the stream", async t2 => {
		const readable = stream.Readable.from([Buffer.from("hello "), Buffer.from("world\n")]);
		t2.equal(await lib.hashStream(readable), helloHash);
	});
	t1.test("hashes an empty stream", async t2 => {
		t2.equal(await lib.hashStream(stream.Readable.from([])), emptyHash);
	});
	t1.test("rejects when the stream errors", async t2 => {
		const error = new Error("read failed");
		const readable = new stream.Readable({
			read() { this.destroy(error); },
		});
		await t2.rejects(lib.hashStream(readable), error);
	});
});

t.test("hashFile()", async t1 => {
	t1.test("hashes the contents of a file", async t2 => {
		const dir = t2.testdir({ "file.txt": "hello world\n" });
		t2.equal(await lib.hashFile(path.join(dir, "file.txt")), helloHash);
	});
	t1.test("hashes a large file", async t2 => {
		const dir = t2.testdir();
		const content = Buffer.alloc(1024 * 1024, "a");
		await fs.writeFile(path.join(dir, "big"), content);
		t2.equal(
			await lib.hashFile(path.join(dir, "big")),
			await lib.hashStream(stream.Readable.from([content])),
		);
	});
	t1.test("rejects for a missing file", async t2 => {
		await t2.rejects(lib.hashFile(path.join(t2.testdir(), "missing")), { code: "ENOENT" });
	});
});
