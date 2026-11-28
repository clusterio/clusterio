/* eslint-disable node/no-sync */
// The browser variant must behave like the node variant, so every case runs against both.
import t from "tap";
import zlib from "node:zlib";
import * as browserZlib from "@clusterio/lib/dist/browser/src/zlib_sync.browser.js";
import * as nodeZlib from "@clusterio/lib/dist/node/src/zlib_sync.node.js";

const variants = [["node", nodeZlib], ["browser", browserZlib]] as const;

const text = JSON.stringify({ name: "pack", mods: [{ name: "base", version: "2.0.0" }] });
const unicode = "Pack ✓ 🎉 é";
const deflated = zlib.deflateSync(text);

function corrupt(data: Uint8Array, index: number) {
	const copy = Buffer.from(data);
	copy[index] ^= 0xff;
	return copy;
}

const invalidInputs: [string, Uint8Array, string][] = [
	["text", Buffer.from("not zlib data"), "Z_DATA_ERROR"],
	["raw deflate data", zlib.deflateRawSync(text), "Z_DATA_ERROR"],
	["gzip data", zlib.gzipSync(text), "Z_DATA_ERROR"],
	["empty input", new Uint8Array(0), "Z_BUF_ERROR"],
	["truncated data", deflated.subarray(0, deflated.length - 6), "Z_BUF_ERROR"],
	["data missing the checksum", deflated.subarray(0, deflated.length - 4), "Z_BUF_ERROR"],
	["data missing a checksum byte", deflated.subarray(0, deflated.length - 1), "Z_BUF_ERROR"],
	["only a header", deflated.subarray(0, 2), "Z_BUF_ERROR"],
	["half a header", deflated.subarray(0, 1), "Z_BUF_ERROR"],
	["a header and part of a block", deflated.subarray(0, 3), "Z_BUF_ERROR"],
	["two bytes that are not a header", Buffer.from("ab"), "Z_DATA_ERROR"],
	["data needing a dictionary", zlib.deflateSync(text, { dictionary: Buffer.from("pack") }), "Z_NEED_DICT"],
];

t.test("inflateSync()", async t1 => {
	for (const [name, zlibSync] of variants) {
		t1.test(name, async t2 => {
			t2.test("inflates data deflated by node:zlib", async t3 => {
				t3.equal(Buffer.from(zlibSync.inflateSync(deflated)).toString(), text);
			});
			t2.test("inflates data larger than one checksum block", async t3 => {
				const large = Buffer.alloc(100_000, 0xff);
				t3.ok(Buffer.from(zlibSync.inflateSync(zlib.deflateSync(large))).equals(large));
			});
			t2.test("returns a Uint8Array", async t3 => {
				t3.type(zlibSync.inflateSync(deflated), Uint8Array);
			});
			for (const [inputName, data, code] of invalidInputs) {
				t2.test(`throws a Z_ error on ${inputName}`, async t3 => {
					let error: any;
					try {
						zlibSync.inflateSync(data);
					} catch (err) {
						error = err;
					}
					t3.type(error, Error);
					// Callers in lib only check for the Z_ prefix.
					t3.match(error?.code, /^Z_/);
					t3.equal(error?.code, code, "same code as node:zlib");
				});
			}
			t2.test("throws on a wrong Adler-32 checksum", async t3 => {
				t3.throws(
					() => zlibSync.inflateSync(corrupt(deflated, deflated.length - 1)),
					{ code: "Z_DATA_ERROR" },
				);
			});
		});
	}
});

t.test("data after the end of the stream", async t1 => {
	const data = Buffer.concat([deflated, Buffer.from("trailing")]);
	t1.test("is ignored by node", async t2 => {
		t2.equal(Buffer.from(nodeZlib.inflateSync(data)).toString(), text);
	});
	t1.test("is rejected by the browser, which reads the checksum from the end", async t2 => {
		t2.throws(() => browserZlib.inflateSync(data), { code: "Z_DATA_ERROR" });
	});
});

t.test("deflateSync()", async t1 => {
	for (const [name, zlibSync] of variants) {
		t1.test(name, async t2 => {
			t2.test("deflates a string", async t3 => {
				t3.equal(zlib.inflateSync(zlibSync.deflateSync(text)).toString(), text);
			});
			t2.test("encodes strings as UTF-8", async t3 => {
				t3.equal(zlib.inflateSync(zlibSync.deflateSync(unicode)).toString(), unicode);
			});
			t2.test("deflates bytes", async t3 => {
				t3.equal(zlib.inflateSync(zlibSync.deflateSync(new TextEncoder().encode(text))).toString(), text);
			});
			t2.test("deflates empty input", async t3 => {
				t3.equal(zlib.inflateSync(zlibSync.deflateSync("")).length, 0);
			});
			t2.test("inflates data larger than one checksum block", async t3 => {
				const large = Buffer.alloc(100_000, 0xff);
				t3.ok(Buffer.from(zlibSync.inflateSync(zlib.deflateSync(large))).equals(large));
			});
			t2.test("returns a Uint8Array", async t3 => {
				t3.type(zlibSync.deflateSync(text), Uint8Array);
			});
			for (const [otherName, other] of variants) {
				t2.test(`round trips through the ${otherName} inflateSync()`, async t3 => {
					const bytes = new Uint8Array([0, 1, 2, 255, 254]);
					t3.strictSame(Buffer.from(other.inflateSync(zlibSync.deflateSync(bytes))), Buffer.from(bytes));
				});
			}
		});
	}
});
