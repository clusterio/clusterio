import assert from "node:assert/strict";
import path from "node:path";

import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import {
	_createSheetState, _exportIcons, _exportLocale, _findGraphicsDataDir, _loadLayeredIcon, _loadSimpleIcon,
	_warnMissingBuiltinIcons,
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
			const count = await _exportIcons(testServer, new Map(), { zipCache: new Map() }, prototypes, "item", state);
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
	describe("findGraphicsDataDir()", function() {
		const installs = path.join("test", "file", "factorio");
		it("returns the data dir of the install matching the server version", async function() {
			const dataDir = await _findGraphicsDataDir(testServer, installs);
			assert.equal(dataDir, path.join(installs, "0.1.2", "data"));
			assert.deepEqual(warnings, []);
		});
		it("warns and returns undefined when no install matches the server version", async function() {
			const server = Object.create(testServer, { version: { value: "0.2.5" } });
			assert.equal(await _findGraphicsDataDir(server, installs), undefined);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /^Unable to use host\.factorio_graphics_directory for Factorio 0\.2, /);
		});
		it("warns and returns undefined when the directory does not exist", async function() {
			assert.equal(await _findGraphicsDataDir(testServer, path.join("test", "file", "missing")), undefined);
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /^Unable to use host\.factorio_graphics_directory for Factorio 0\.1, .*ENOENT/);
		});
	});
	describe("warnMissingBuiltinIcons()", function() {
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
