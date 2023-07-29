"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const lib = require("@clusterio/lib");

const testStrings = require("./test_strings");


// Simple linear congruential random number generator
class Random {
	constructor(seed) {
		this.prev = seed;
	}

	next() {
		let curr = (1103515245 * this.prev + 12345) & 0x7fffffff;
		this.prev = curr;
		return curr >> 16;
	}
}

describe("lib/factorio/exchange_string", function() {
	describe("readMapExchangeString", function() {
		it("should parse a valid string", function() {
			let result = lib.readMapExchangeString(testStrings.default);
			assert.equal(result.map_gen_settings.seed, 1234567890);

			result = lib.readMapExchangeString(testStrings.modified);
			assert.equal(result.checksum, 4092204126);
		});

		it("should handle malformed strings", function() {
			assert.throws(
				() => lib.readMapExchangeString("<<blah>>"),
				new Error("Not a map exchange string")
			);

			assert.throws(
				() => lib.readMapExchangeString(testStrings.default.slice(0, 100)),
				new Error("Not a map exchange string")
			);

			assert.throws(
				() => lib.readMapExchangeString(`>>>${Buffer.from("abk430ia404ah3b4").toString("base64")}<<<`),
				new Error("Malformed map exchange string: zlib inflate failed")
			);

			for (let i = 0; i < 100; i++) {
				let gen = new Random(i);
				let size = gen.next() % 200 + 100;
				let data = Buffer.alloc(size);
				for (let j = 0; j < size; j++) {
					data[j] = gen.next() % 256;
				}
				// eslint-disable-next-line node/no-sync
				data = zlib.deflateSync(data);
				assert.throws(
					() => lib.readMapExchangeString(`>>>${data.toString("base64")}<<<`),
					new Error("Malformed map exchange string: reached end before finishing parsing")
				);
			}

			let pastEnd = Buffer.from(testStrings.default.replace(/><\n/g, ""), "base64");
			// eslint-disable-next-line node/no-sync
			pastEnd = zlib.deflateSync(Buffer.concat([zlib.inflateSync(pastEnd), Buffer.from("junk")]));
			assert.throws(
				() => lib.readMapExchangeString(`>>>${pastEnd.toString("base64")}<<<`),
				new Error("Malformed map exchange string: data after end")
			);
		});
	});
});
