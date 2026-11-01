import assert from "node:assert/strict";
import path from "node:path";

import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import {
	_createSheetState, _exportIcons, _exportLocale, _loadLayeredIcon, _loadSimpleIcon,
} from "@clusterio/host/dist/node/src/export.js";


describe("host/src/export", function() {
	let testServer;
	before(async function() {
		let writePath = path.join("temp", "test", "server");
		testServer = await FactorioServer.fromOptions(path.join("test", "file", "factorio"), writePath, {});
	});

	let warnings;
	let originalLogger;
	beforeEach(function() {
		warnings = [];
		originalLogger = testServer._logger;
		testServer._logger = Object.create(originalLogger, { warn: { value: message => warnings.push(message) } });
	});
	afterEach(function() {
		testServer._logger = originalLogger;
	});

	describe("exportLocale()", function() {
		it("warns about mods without a zip and exports the rest", async function() {
			const locale = await _exportLocale(
				testServer, new Map([["missing_mod", "1.0.0"]]), new Map(), ["base", "missing_mod"], "en"
			);
			assert.equal(locale.size > 0, true);
			assert.deepEqual(warnings, ["Skipping locale of missing_mod, its mod zip was not found"]);
		});
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
	describe("exportIcons()", function() {
		it("skips icons that fail to load and exports the rest", async function() {
			const state = await _createSheetState();
			const icon = "__base__/graphics/icons/test-icon.png";
			const prototypes = [
				{ type: "item", name: "first", icon, icon_size: 64 },
				{ type: "item", name: "no-layers", icons: [] },
				{ type: "item", name: "unknown-mod", icon: "__not-a-mod__/graphics/icons/x.png", icon_size: 64 },
				{ type: "item", name: "last", icon, icon_size: 64 },
			];
			const count = await _exportIcons(testServer, new Map(), new Map(), prototypes, "item", state);
			assert.equal(count, 2);
			assert.deepEqual(
				state.metadata.item.map(entry => [entry.name, Boolean(entry.icon)]),
				[["first", true], ["no-layers", false], ["unknown-mod", false], ["last", true]],
			);
			assert.equal(warnings.length, 2);
			assert.match(warnings[0], /^Skipping icon of item no-layers: /);
			assert.match(warnings[1], /^Skipping icon of item unknown-mod: Got path for unknown mod not-a-mod/);
		});
	});

	describe("loadSimpleIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadSimpleIcon(
				testServer, new Map(), new Map(), { icon: "__base__/graphics/icons/test-icon.png" }, 32, new Map()
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(31, 16), red);
		});
	});
	describe("loadLayeredIcon()", function() {
		it("defaults icon_size to 64", async function() {
			const icon = await _loadLayeredIcon(
				testServer, new Map(), new Map(),
				{ icons: [{ icon: "__base__/graphics/icons/test-icon.png" }] }, 32, new Map(),
			);
			assert.equal(icon.bitmap.width, 32);
			assert.equal(icon.bitmap.height, 32);
			assert.equal(icon.getPixelColor(0, 0), red);
			assert.equal(icon.getPixelColor(31, 31), red);
		});
	});
});
