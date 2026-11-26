import zlib from "node:zlib";
import t from "tap";
import * as lib from "@clusterio/lib";

import * as strings from "../../shared/exchange_string/strings.ts";
import * as settings from "../../shared/exchange_string/settings.ts";

// Inflated payload of an exchange string
function payload(exchangeString: string) {
	// eslint-disable-next-line node/no-sync
	return zlib.inflateSync(Buffer.from(exchangeString.replace(/[<>\s]/g, ""), "base64"));
}

function encode(data: Buffer) {
	// eslint-disable-next-line node/no-sync
	return `>>>${zlib.deflateSync(data).toString("base64")}<<<`;
}

// Simple linear congruential random number generator
function random(seed: number) {
	let prev = seed;
	return () => {
		prev = (1103515245 * prev + 12345) & 0x7fffffff;
		return prev >> 16;
	};
}

t.test("readMapExchangeString()", async t1 => {
	t1.test("parses 1.1 strings", async t2 => {
		t2.strictSame(lib.readMapExchangeString(strings.default), {
			version: [1, 1, 33, 0],
			unknown: 0,
			map_gen_settings: settings.default_map_gen_settings,
			map_settings: settings.default_map_settings,
			checksum: 3169422966,
		});
		t2.strictSame(lib.readMapExchangeString(strings.modified), {
			version: [1, 1, 33, 0],
			unknown: 0,
			map_gen_settings: settings.modified_map_gen_settings,
			map_settings: settings.modified_map_settings,
			checksum: 4092204126,
		});
	});
	t1.test("parses 2.0 strings", async t2 => {
		t2.strictSame(lib.readMapExchangeString(strings.modified_v2), {
			version: [2, 0, 47, 0],
			unknown: 0,
			map_gen_settings: settings.modified_v2_map_gen_settings,
			map_settings: settings.modified_v2_map_settings,
			checksum: 979461261,
		});
		t2.strictSame(lib.readMapExchangeString(strings.modified_space_age), {
			version: [2, 0, 47, 0],
			unknown: 0,
			map_gen_settings: settings.modified_space_age_map_gen_settings,
			map_settings: settings.modified_v2_map_settings,
			checksum: 1746300027,
		});
	});
	t1.test("parses 2.1 strings before 2.1.13", async t2 => {
		t2.strictSame(lib.readMapExchangeString(strings.modified_v2_1), {
			version: [2, 1, 9, 3],
			unknown: 0,
			map_gen_settings: settings.modified_v2_1_map_gen_settings,
			map_settings: settings.modified_v2_1_map_settings,
			checksum: 3180296799,
		});
	});
	t1.test("parses 2.1.13 to 2.1.17 strings", async t2 => {
		t2.strictSame(lib.readMapExchangeString(strings.modified_v2_1_13), {
			version: [2, 1, 14, 1],
			unknown: 0,
			map_gen_settings: settings.modified_v2_1_map_gen_settings,
			map_settings: settings.modified_v2_1_13_map_settings,
			checksum: 272054359,
		});
		t2.strictSame(lib.readMapExchangeString(strings.modified_v2_1_17), {
			version: [2, 1, 17, 0],
			unknown: 0,
			map_gen_settings: settings.modified_v2_1_map_gen_settings,
			map_settings: settings.modified_v2_1_13_map_settings,
			checksum: 1073352633,
		});
	});
	t1.test("parses 2.1.18 strings", async t2 => {
		t2.strictSame(lib.readMapExchangeString(strings.modified_v2_1_18), {
			version: [2, 1, 18, 4],
			unknown: 0,
			map_gen_settings: settings.modified_v2_1_map_gen_settings,
			map_settings: settings.modified_v2_1_18_map_settings,
			checksum: 1437579271,
		});
	});
	t1.test("ignores whitespace", async t2 => {
		const spaced = strings.modified_v2.replace(/(.{10})/g, "$1 \t\r\n");
		t2.strictSame(lib.readMapExchangeString(spaced), lib.readMapExchangeString(strings.modified_v2));
	});
	t1.test("reads strings longer than 254 bytes", async t2 => {
		const data = payload(strings.default);
		const coal = Buffer.from([4, ...Buffer.from("coal")]);
		const index = data.indexOf(coal);
		t2.not(index, -1);
		const longName = "c".repeat(300);
		const length = Buffer.alloc(5);
		length.writeUInt8(0xff, 0);
		length.writeUInt32LE(longName.length, 1);
		const patched = Buffer.concat([
			data.subarray(0, index), length, Buffer.from(longName), data.subarray(index + coal.length),
		]);
		const result = lib.readMapExchangeString(encode(patched));
		const controls = result.map_gen_settings.autoplace_controls;
		t2.notOk("coal" in controls);
		t2.strictSame(controls[longName], settings.default_map_gen_settings.autoplace_controls.coal);
	});

	t1.test("reads territory settings", async t2 => {
		const data = payload(strings.modified_v2);
		// cliff name, empty control and 4 floats come right before the optional territory settings
		const cliff = data.indexOf(Buffer.from([5, ...Buffer.from("cliff"), 0]));
		t2.not(cliff, -1);
		const flag = cliff + 7 + 16;
		t2.equal(data[flag], 0);
		const territory = Buffer.concat([
			Buffer.from([1, 1, 11]), Buffer.from("small-biter"),
			Buffer.from([5]), Buffer.from("index"),
			Buffer.from([9]), Buffer.from("variation"),
			Buffer.from([7, 0, 0, 0]),
		]);
		const patched = Buffer.concat([data.subarray(0, flag), territory, data.subarray(flag + 1)]);
		const result = lib.readMapExchangeString(encode(patched)).map_gen_settings as any;
		t2.strictSame(result.territory_settings, {
			units: ["small-biter"],
			territory_index_expression: "index",
			territory_variation_expression: "variation",
			minimum_territory_size: 7,
		});
	});
	t1.test("reads positions relative to the previous one", async t2 => {
		const data = payload(strings.default);
		// One absolute starting point at 0, 0, then an empty property_expression_names and the cliff name
		const points = Buffer.from([1, 0xff, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, ...Buffer.from("cliff")]);
		const index = data.indexOf(points);
		t2.not(index, -1);
		const replacement = Buffer.alloc(15);
		replacement.writeUInt8(2, 0);
		replacement.writeInt16LE(0x7fff, 1);
		replacement.writeInt32LE(10 * 256, 3);
		replacement.writeInt32LE(20 * 256, 7);
		replacement.writeInt16LE(1 * 256, 11);
		replacement.writeInt16LE(2 * 256, 13);
		const patched = Buffer.concat([data.subarray(0, index), replacement, data.subarray(index + 11)]);
		const result = lib.readMapExchangeString(encode(patched));
		t2.strictSame(
			result.map_gen_settings.starting_points,
			[{ x: 10, y: 20 }, { x: 11, y: 22 }]);
	});

	t1.test("reads the string between the markers and ignores text around them", async t2 => {
		const expected = lib.readMapExchangeString(strings.default);
		t2.strictSame(lib.readMapExchangeString(`Map: ${strings.default} (copied)`), expected);
		t2.strictSame(lib.readMapExchangeString(`<<<${strings.default}>>>`), expected);
	});
	t1.test("rejects text that is not an exchange string", async t2 => {
		t2.throws(() => lib.readMapExchangeString("<<blah>>"), new Error("Not a map exchange string"));
		t2.throws(() => lib.readMapExchangeString(">>><<<"), new Error("Not a map exchange string"));
		t2.throws(
			() => lib.readMapExchangeString(strings.default.slice(0, 100)),
			new Error("Not a map exchange string")
		);
	});
	t1.test("rejects data that is not deflated", async t2 => {
		t2.throws(
			() => lib.readMapExchangeString(`>>>${Buffer.from("abk430ia404ah3b4").toString("base64")}<<<`),
			new Error("Malformed map exchange string: zlib inflate failed")
		);
	});
	t1.test("rejects truncated data", async t2 => {
		const data = payload(strings.modified_v2_1_18);
		for (const length of [2, 9, 100, data.length - 1]) {
			t2.throws(
				() => lib.readMapExchangeString(encode(data.subarray(0, length))),
				new Error("Malformed map exchange string: reached end before finishing parsing"),
				`length ${length}`
			);
		}
	});
	t1.test("rejects data too short for the first read", async t2 => {
		for (const length of [0, 1]) {
			t2.throws(
				() => lib.readMapExchangeString(encode(Buffer.alloc(length))),
				new Error("Malformed map exchange string: reached end before finishing parsing"));
		}
	});
	t1.test("passes on errors from inflate that are not from zlib", async t2 => {
		const error = Object.assign(new Error("Other"), { code: "ERR_OTHER" });
		const { readMapExchangeString }: typeof lib = await t2.mockImport(
			"@clusterio/lib/dist/node/src/factorio/exchange_string.js",
			{ "#zlib_sync": { inflateSync: () => { throw error; } } },
		);
		t2.throws(() => readMapExchangeString(strings.default), error);
	});
	t1.test("rejects random data", async t2 => {
		for (let i = 0; i < 100; i++) {
			const next = random(i);
			const data = Buffer.alloc(next() % 200 + 100);
			for (let j = 0; j < data.length; j++) {
				data[j] = next() % 256;
			}
			t2.throws(
				() => lib.readMapExchangeString(encode(data)),
				new Error("Malformed map exchange string: reached end before finishing parsing"),
				`seed ${i}`
			);
		}
	});
	t1.test("rejects data after the end", async t2 => {
		const data = Buffer.concat([payload(strings.default), Buffer.from("junk")]);
		t2.throws(
			() => lib.readMapExchangeString(encode(data)),
			new Error("Malformed map exchange string: data after end")
		);
	});
});
