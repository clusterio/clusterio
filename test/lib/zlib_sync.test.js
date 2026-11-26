/* eslint-disable node/no-sync */
import assert from "node:assert/strict";
import zlib from "node:zlib";

import * as browserZlib from "../../packages/lib/src/zlib_sync.browser.ts";

describe("lib/zlib_sync.browser", function() {
	const text = JSON.stringify({ name: "pack", mods: [{ name: "base", version: "2.0.0" }] });

	it("should inflate data deflated by node:zlib", function() {
		const inflated = browserZlib.inflateSync(zlib.deflateSync(text));
		assert.equal(Buffer.from(inflated).toString(), text);
	});
	it("should deflate data node:zlib can inflate", function() {
		assert.equal(zlib.inflateSync(browserZlib.deflateSync(text)).toString(), text);
		const bytes = Buffer.from(text);
		assert.equal(zlib.inflateSync(browserZlib.deflateSync(bytes)).toString(), text);
	});
	it("should throw with a Z_ code on invalid data", function() {
		assert.throws(
			() => browserZlib.inflateSync(Buffer.from("not zlib data")),
			err => err.code === "Z_DATA_ERROR"
		);
	});
	it("should throw with the same code as node:zlib", function() {
		const deflated = zlib.deflateSync(text);
		const cases = [
			[new Uint8Array(0), "Z_BUF_ERROR"],
			[deflated.subarray(0, 2), "Z_BUF_ERROR"],
			[deflated.subarray(0, deflated.length - 1), "Z_BUF_ERROR"],
			[zlib.deflateSync(text, { dictionary: Buffer.from("pack") }), "Z_NEED_DICT"],
		];
		for (const [data, code] of cases) {
			assert.throws(() => browserZlib.inflateSync(data), err => err.code === code);
			assert.throws(() => zlib.inflateSync(data), err => err.code === code);
		}
	});
	it("should reject a wrong checksum", function() {
		const deflated = Buffer.from(zlib.deflateSync(Buffer.alloc(10000, 1)));
		deflated[deflated.length - 1] ^= 0xff;
		assert.throws(() => browserZlib.inflateSync(deflated), err => err.code === "Z_DATA_ERROR");
	});
});
