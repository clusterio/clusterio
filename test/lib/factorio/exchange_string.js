"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const lib = require("@clusterio/lib");

const testStrings = require("./test_strings");
const testSettings = require("./test_settings");


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
		it("should parse post v0.16 strings", function() {
			assert.deepEqual(lib.readMapExchangeString(testStrings.default), {
				version: [1, 1, 33, 0],
				unknown: 0,
				map_gen_settings: testSettings.default_map_gen_settings,
				map_settings: testSettings.default_map_settings,
				checksum: 3169422966,
			});

			assert.deepEqual(lib.readMapExchangeString(testStrings.modified), {
				version: [1, 1, 33, 0],
				unknown: 0,
				map_gen_settings: testSettings.modified_map_gen_settings,
				map_settings: testSettings.modified_map_settings,
				checksum: 4092204126,
			});
		});

		it("should parse post v2.0 strings", function() {
			assert.deepEqual(lib.readMapExchangeString(testStrings.modified_v2), {
				version: [2, 0, 47, 0],
				unknown: 0,
				map_gen_settings: testSettings.modified_v2_map_gen_settings,
				map_settings: testSettings.modified_v2_map_settings,
				checksum: 979461261,
			});

			assert.deepEqual(lib.readMapExchangeString(testStrings.modified_space_age), {
				version: [2, 0, 47, 0],
				unknown: 0,
				map_gen_settings: testSettings.modified_space_age_map_gen_settings,
				map_settings: testSettings.modified_v2_map_settings,
				checksum: 1746300027,
			});
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
