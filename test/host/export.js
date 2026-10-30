import assert from "node:assert/strict";
import path from "node:path";

import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import {
	_exportLocale, _loadLayeredIcon, _loadSimpleIcon, _warnMissingBuiltinIcons,
} from "@clusterio/host/dist/node/src/export.js";


describe("host/src/export", function() {
	let testServer;
	before(async function() {
		let writePath = path.join("temp", "test", "server");
		testServer = await FactorioServer.fromOptions(path.join("test", "file", "factorio"), writePath, {});
	});

	describe("exportLocale()", function() {
		it("returns a flattened mapping with locale definitions", async function() {
			let locale = await _exportLocale(testServer, new Map(), new Map(), ["base"], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
				["test.base-a", "1"], ["test.base-b", "2"],
			]));
		});
		it("returns a filtered locale definitions based on mod order", async function() {
			let locale = await _exportLocale(testServer, new Map(), new Map(), [], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
			]));
		});
	});

	// test-icon.png is a red 64px icon followed by a blue 32px mipmap
	const red = 0xff0000ff;
	// Stands in for the data dir of a full install
	const graphicsDataDir = path.join("test", "file", "factorio-graphics");
	describe("loadSimpleIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadSimpleIcon(
				testServer, new Map(), { zipCache: new Map() },
				{ icon: "__base__/graphics/icons/test-icon.png" }, 32, new Map(),
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(31, 16), red);
		});
		it("returns null when the icon file is missing", async function() {
			const icon = await _loadSimpleIcon(
				testServer, new Map(), { zipCache: new Map() },
				{ icon: "__base__/graphics/icons/graphics-icon.png" }, 32, new Map(),
			);
			assert.equal(icon, null);
		});
		it("falls back to graphicsDataDir for builtin mod files", async function() {
			const icon = await _loadSimpleIcon(
				testServer, new Map(), { zipCache: new Map(), graphicsDataDir },
				{ icon: "__base__/graphics/icons/graphics-icon.png" }, 32, new Map(),
			);
			assert.equal(icon.getPixelColor(31, 16), red);
		});
	});
	describe("loadLayeredIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadLayeredIcon(
				testServer, new Map(), { zipCache: new Map() },
				{ icons: [{ icon: "__base__/graphics/icons/test-icon.png" }] }, 32, new Map(),
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(0, 0), red);
			assert.equal(icon.getPixelColor(31, 31), red);
		});
		it("returns null when a layer is missing", async function() {
			const icon = await _loadLayeredIcon(
				testServer, new Map(), { zipCache: new Map() },
				{ icons: [
					{ icon: "__base__/graphics/icons/test-icon.png" },
					{ icon: "__base__/graphics/icons/missing.png" },
				] }, 32, new Map(),
			);
			assert.equal(icon, null);
		});
	});
	describe("warnMissingBuiltinIcons()", function() {
		let warnings;
		let logger;
		beforeEach(function() {
			warnings = [];
			logger = testServer._logger;
			testServer._logger = { warn: msg => warnings.push(msg) };
		});
		afterEach(function() {
			testServer._logger = logger;
		});

		it("warns once with the number of missing builtin files", function() {
			_warnMissingBuiltinIcons(testServer, { zipCache: new Map() }, new Map([
				["__base__/graphics/icons/a.png", null],
				["__core__/graphics/icons/b.png", null],
				["__base__/graphics/icons/c.png", {}],
				["__some_mod__/graphics/icons/d.png", null],
			]));
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /^2 icon files of the base game were not found/);
			assert.match(warnings[0], /headless/);
		});
		it("does not warn when no builtin files are missing", function() {
			_warnMissingBuiltinIcons(testServer, { zipCache: new Map() }, new Map([
				["__base__/graphics/icons/c.png", {}],
				["__some_mod__/graphics/icons/d.png", null],
			]));
			assert.deepEqual(warnings, []);
		});
	});
});
