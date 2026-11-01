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
	const graphicsDataDir = path.join("test", "file", "factorio-mixed", "full", "data");
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
		const withInstalls = (factorioDir, version = testServer.version) => Object.create(testServer, {
			_factorioDir: { value: factorioDir }, version: { value: version },
		});
		it("finds a full install matching the major and minor version of the server", async function() {
			const files = { zipCache: new Map() };
			await _findGraphicsDataDir(withInstalls(path.join("test", "file", "factorio"), "0.1.1"), files);
			assert.deepEqual(files, { zipCache: new Map(), graphicsDataDir: path.join(installs, "0.1.2", "data") });
		});
		it("skips headless installs of the same version", async function() {
			const files = { zipCache: new Map() };
			await _findGraphicsDataDir(withInstalls(path.join("test", "file", "factorio-mixed")), files);
			assert.equal(files.graphicsDataDir, graphicsDataDir);
		});
		it("records why when there is no full install", async function() {
			const files = { zipCache: new Map() };
			await _findGraphicsDataDir(withInstalls(installs, "0.2.5"), files);
			assert.equal(files.graphicsDataDir, undefined);
			assert.equal(files.graphicsError, "Unable to find full Factorio version 0.2");
		});
		it("records why when the directory does not exist", async function() {
			const files = { zipCache: new Map() };
			await _findGraphicsDataDir(withInstalls(path.join("test", "file", "missing")), files);
			assert.match(files.graphicsError, /ENOENT/);
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
			assert.doesNotMatch(warnings[0], /headless/);
		});
		it("explains the headless build when no full install was found", function() {
			_warnMissingBuiltinIcons(testServer, { zipCache: new Map(), graphicsError: "Not found" }, new Map([
				["__base__/graphics/icons/a.png", null],
			]));
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /has no graphics and no full install was found \(Not found\)/);
			assert.match(warnings[0], /Add a full install of Factorio 0\.1 to host\.factorio_directory/);
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
