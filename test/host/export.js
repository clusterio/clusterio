import assert from "node:assert/strict";
import path from "node:path";

import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import { _exportLocale, _loadLayeredIcon, _loadSimpleIcon } from "@clusterio/host/dist/node/src/export.js";


describe("host/src/export", function() {
	let testServer;
	before(async function() {
		let writePath = path.join("temp", "test", "server");
		testServer = new FactorioServer(path.join("test", "file", "factorio"), writePath, {});
		await testServer.init();
	});

	describe("exportLocale()", function() {
		it("returns a flattened mapping with locale definitions", async function() {
			let locale = await _exportLocale(testServer, new Map(), ["base"], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
				["test.base-a", "1"], ["test.base-b", "2"],
			]));
		});
		it("returns a filtered locale definitions based on mod order", async function() {
			let locale = await _exportLocale(testServer, new Map(), [], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
			]));
		});
	});

	// test-icon.png is a red 64px icon followed by a blue 32px mipmap
	const red = 0xff0000ff;
	describe("loadSimpleIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadSimpleIcon(
				testServer, new Map(), { icon: "__base__/graphics/icons/test-icon.png" }, 32, new Map()
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(31, 16), red);
		});
	});
	describe("loadLayeredIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadLayeredIcon(
				testServer, new Map(), { icons: [{ icon: "__base__/graphics/icons/test-icon.png" }] }, 32, new Map()
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(0, 0), red);
			assert.equal(icon.getPixelColor(31, 31), red);
		});
	});
});
