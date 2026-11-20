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
});
