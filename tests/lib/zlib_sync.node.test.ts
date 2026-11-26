/* eslint-disable node/no-sync */
import t from "tap";
import zlib from "node:zlib";
import * as zlibSync from "@clusterio/lib/dist/node/src/zlib_sync.node.js";

const text = JSON.stringify({ name: "pack", mods: [{ name: "base", version: "2.0.0" }] });

t.test("inflateSync()", async t1 => {
	t1.test("inflates data deflated by node:zlib", async t2 => {
		t2.equal(Buffer.from(zlibSync.inflateSync(zlib.deflateSync(text))).toString(), text);
	});
	t1.test("throws with a Z_ code on invalid data", async t2 => {
		t2.throws(() => zlibSync.inflateSync(Buffer.from("not zlib data")), { code: "Z_DATA_ERROR" });
	});
});

t.test("deflateSync()", async t1 => {
	t1.test("deflates a string", async t2 => {
		t2.equal(zlib.inflateSync(zlibSync.deflateSync(text)).toString(), text);
	});
	t1.test("deflates bytes", async t2 => {
		t2.equal(zlib.inflateSync(zlibSync.deflateSync(new TextEncoder().encode(text))).toString(), text);
	});
	t1.test("round trips through inflateSync()", async t2 => {
		const bytes = new Uint8Array([0, 1, 2, 255, 254]);
		t2.strictSame(Buffer.from(zlibSync.inflateSync(zlibSync.deflateSync(bytes))), Buffer.from(bytes));
	});
});
