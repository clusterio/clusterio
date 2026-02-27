// Export of item icons and locale
import fs from "fs-extra";
import path from "path";
import Jimp from "jimp";
import JSZip from "jszip";

import * as lib from "@clusterio/lib";
import * as libBuildMod from "@clusterio/lib/dist/node/build_mod";
import type { FactorioServer } from "./server";

interface Prototype {
	[index: string]: unknown,
	type: string,
	name: string,
}
interface SimpleIconSpecification {
	icon: string;
	icon_size?: number;
	icon_mipmaps?: number;
}
interface IconLayer {
	icon: string;
	icon_size?: number;
	tint?: lib.FactorioColor,
	shift?: [number, number],
	scale?: number,
	icon_mipmaps?: number,
}
interface LayeredIconSpecification {
	icons: IconLayer[];
	icon_size?: number;
	icon_mipmaps?: number;
}
type IconSpecification = LayeredIconSpecification | SimpleIconSpecification;
type ItemPrototype = Prototype & IconSpecification;


type Prototypes = Record<string, Record<string, Prototype>>

/**
 * Generate the export mod needed for exportData
 *
 * Packs the lua export mod located in lua/export into the mods folder for
 * the server given, with dependencies generated for all the mods present in
 * the server's mods folder.
 *
 * @param server -
 *     The server to generate the export mod for.
 */
async function generateExportMod(server: FactorioServer) {
	let dependencies = [];
	let splitter = /^(.*)_(\d+\.\d+\.\d+)(\.zip)?$/;
	for (let entry of await fs.readdir(server.writePath("mods"))) {
		let match = splitter.exec(entry);
		if (match && match[1] !== "export") {
			dependencies.push(`? ${match[1]}`);
		}
	}

	await libBuildMod.build({
		clean: false,
		build: true,
		pack: true,
		sourceDir: path.join(__dirname, "..", "..", "..", "lua", "export"),
		outputDir: server.writePath("mods"),
		bumpPatch: false,
		factorioVersion: server.version?.replace(/\.\d+$/, ""),
		dependencies,
	});
}

let zipCache = new Map();
async function loadZip(server: FactorioServer, modVersions: Map<string, string>, mod: string) {
	let modVersion = modVersions.get(mod);
	if (!modVersion) {
		throw new Error(`Got path for unknown mod ${mod}`);
	}

	let zipPath = server.writePath("mods", `${mod}_${modVersion}.zip`);
	let zip = zipCache.get(zipPath);
	if (!zip) {
		zip = await JSZip.loadAsync(await fs.readFile(zipPath));
		zipCache.set(zipPath, zip);
	}

	return zip.folder(lib.findRoot(zip));
}

/**
 * Load the given Factorio file path into a Buffer
 *
 * @param server - The server to load the file from.
 * @param modVersions - Mapping of mod to version used.
 * @param modPath - Factorio style path to the file to load.
 * @returns The content of the file or null if not found.
 * @internal
 */
async function loadFile(server: FactorioServer, modVersions: Map<string, string>, modPath: string) {
	let match = /^__([^\/]+)__\/(.*)$/.exec(modPath);
	if (!match) {
		server._logger.warn(`Skipping icon with bad mod path: ${JSON.stringify(modPath)}`);
		return null;
	}

	let [, mod, filePath] = match;

	const builtinModNames = ["core", ...lib.ModPack.getBuiltinModNames(server.version!)];
	if (builtinModNames.includes(mod)) {
		try {
			return await fs.readFile(server.dataPath(mod, filePath));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				return null;
			}
			throw err;
		}
	}

	let zip;
	try {
		zip = await loadZip(server, modVersions, mod);
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return null;
		}
		throw err;
	}

	let file = zip.file(filePath);
	if (!file) {
		return null;
	}

	return await file.async("nodebuffer");
}

type IconCache = Map<string, Jimp | null>;
async function loadIcon(
	server: FactorioServer,
	modVersions: Map<string, string>,
	iconPath: string,
	iconSize: number,
	iconMipmaps: number,
	iconCache: IconCache,
) {
	let icon = iconCache.get(iconPath);
	if (icon === undefined) {
		let fileContent = await loadFile(server, modVersions, iconPath);
		if (fileContent) {
			icon = await Jimp.read(fileContent);
			icon.crop(0, 0, iconSize, iconSize);
			iconCache.set(iconPath, icon);
		} else {
			icon = null;
		}
		iconCache.set(iconPath, icon);
	}
	return icon;
}

async function loadSimpleIcon(
	server: FactorioServer,
	modVersions: Map<string, string>,
	item: SimpleIconSpecification,
	size: number,
	iconCache: IconCache,
) {
	let icon = await loadIcon(server, modVersions, item.icon, item.icon_size ?? 64, 0, iconCache);
	if (icon) {
		let iconScale = size / (item.icon_size ?? 64);
		if (iconScale !== 1) {
			icon = icon.clone();
			icon.scale(iconScale);
		}
	}
	return icon;
}

async function loadLayeredIcon(
	server: FactorioServer,
	modVersions: Map<string, string>,
	item: LayeredIconSpecification,
	size: number,
	iconCache: IconCache,
) {
	let baseLayerSize = (item.icons[0].icon_size || item.icon_size) ?? 64;
	let icon = await Jimp.create(size, size);

	// The scaling factor of the base layer
	let baseLayerScale = item.icons[0].scale || 32 / baseLayerSize;

	// The size in pixels of one unit
	let baseUnit = size / (baseLayerSize * baseLayerScale);

	for (let layer of item.icons) {
		let layerSize = (layer.icon_size || item.icon_size) ?? 64;
		let iconLayer = await loadIcon(server, modVersions, layer.icon, layerSize, layer.icon_mipmaps || 0, iconCache);

		if (!iconLayer) {
			continue;
		}

		iconLayer = iconLayer.clone();

		let tint: lib.Color;
		if (layer.tint) {
			tint = lib.normalizeColor(layer.tint);
		} else {
			tint = { r: 1, b: 1, g: 1, a: 1 };
		}

		let layerScale = layer.scale || 32 / layerSize;
		let [xs, ys] = layer.shift || [0, 0];
		let realScale = layerScale * baseUnit;
		let sizeShift = (size - layerSize * realScale) / 2;

		xs = xs * baseUnit + sizeShift;
		ys = ys * baseUnit + sizeShift;

		if (realScale !== 1) {
			iconLayer.scale(realScale);
		}


		iconLayer.scan(0, 0, iconLayer.bitmap.width, iconLayer.bitmap.height, (x, y, sidx) => {
			x += xs;
			y += ys;
			if (x < 0 || x >= size || y < 0 || y >= size) {
				return;
			}
			let sdata = iconLayer!.bitmap.data;
			let ddata = icon.bitmap.data;
			let didx = icon.getPixelIndex(x, y);

			let sa = sdata[sidx + 3] / 255;
			let da = ddata[didx + 3] / 255;
			let db = da * (1 - sa * tint.a);
			let cb = sa + da * (1 - sa);
			ddata[didx + 0] = Math.min(255, (sdata[sidx + 0] * sa * tint.r + ddata[didx + 0] * db) / cb);
			ddata[didx + 1] = Math.min(255, (sdata[sidx + 1] * sa * tint.g + ddata[didx + 1] * db) / cb);
			ddata[didx + 2] = Math.min(255, (sdata[sidx + 2] * sa * tint.b + ddata[didx + 2] * db) / cb);
			ddata[didx + 3] = Math.min(255, sdata[sidx + 3] + ddata[didx + 3] * (1 - sa));
		});
	}

	return icon;
}

function fixIcons(item: ItemPrototype) {
	const icons = item.icons;
	if (typeof icons === "object" && !(icons instanceof Array) && icons !== null) {
		// It's possible to specify icons as an object with arbitrary keys
		// and the game will still accept it, cast the value to array if
		// this is the case.
		item = { ...item };
		item.icons = Object.values(icons);
	}
	return item;
}

/** Get the primary icon path from a prototype (first layer for layered, .icon for simple). */
function getPrimaryIconPath(item: ItemPrototype): string | undefined {
	if (item.icons) {
		return (item as LayeredIconSpecification).icons[0]?.icon;
	}
	return (item as SimpleIconSpecification).icon;
}

const itemTypes = new Set([
	"item",
	"ammo",
	"capsule",
	"gun",
	"item-with-entity-data",
	"item-with-label",
	"item-with-inventory",
	"blueprint-book",
	"item-with-tags",
	"selection-tool",
	"blueprint",
	"copy-paste-tool",
	"deconstruction-item",
	"upgrade-item",
	"module",
	"rail-planner",
	"spidertron-remote",
	"tool",
	"armor",
	"mining-tool",
	"repair-tool",
	// XXX Bad hack to get icons for fluids. These should be treated as a
	// separate namespace from items as they may be named the same as items.
	"fluid",
]);

const recipeTypes = new Set(["recipe"]);
const signalTypes = new Set(["virtual-signal"]);
const technologyTypes = new Set(["technology"]);
const planetTypes = new Set(["planet", "space-location"]);
const qualityTypes = new Set(["quality"]);

// Entity types to export. Entities whose name matches an already-exported
const entityTypes = new Set([
	"assembling-machine", "furnace", "inserter", "transport-belt", "underground-belt",
	"splitter", "loader", "loader-1x1", "mining-drill", "container", "logistic-container",
	"electric-pole", "pipe", "pipe-to-ground", "pump", "storage-tank", "boiler",
	"generator", "solar-panel", "accumulator", "reactor", "heat-pipe", "lab", "beacon",
	"roboport", "lamp", "radar", "wall", "gate", "land-mine", "turret", "ammo-turret",
	"electric-turret", "fluid-turret", "artillery-turret", "rocket-silo", "car",
	"spider-vehicle", "locomotive", "cargo-wagon", "fluid-wagon", "artillery-wagon",
	"train-stop", "rail-signal", "rail-chain-signal", "straight-rail", "curved-rail-a",
	"curved-rail-b", "half-diagonal-rail", "elevated-straight-rail", "elevated-curved-rail-a",
	"elevated-curved-rail-b", "elevated-half-diagonal-rail", "rail-ramp", "rail-support",
	"space-platform-hub", "cargo-bay", "asteroid-collector", "thruster", "cargo-pod",
	"cargo-landing-pad", "asteroid",
	"construction-robot", "logistic-robot", "combat-robot", "capture-robot",
	"unit", "unit-spawner", "spider-unit", "segmented-unit",
	"tree", "plant", "fish", "resource", "cliff", "simple-entity",
	"simple-entity-with-owner", "simple-entity-with-force",
	"arithmetic-combinator", "decider-combinator", "constant-combinator",
	"selector-combinator", "programmable-speaker", "power-switch", "display-panel",
	"character",
	"offshore-pump", "valve", "lightning-attractor",
	"fusion-generator", "fusion-reactor", "burner-generator",
	"agricultural-tower", "market", "lane-splitter",
]);

function filterPrototypes(prototypes: Prototypes, types: Set<string>): ItemPrototype[] {
	return Object.entries(prototypes)
		.filter(([type]) => types.has(type))
		.flatMap(([_, typePrototypes]) => Object.values(typePrototypes) as ItemPrototype[])
		.map(fixIcons);
}

/** Shared state for building a unified spritesheet across all categories. */
interface SheetState {
	sheet: Jimp;
	metadata: Map<string, { x: number, y: number, size: number, category: string, path?: string }>;
	iconCache: IconCache;
	simpleIcons: Map<string, number>;
	pos: number;
}

const SHEET_ICON_SIZE = 32;
const SHEET_WIDTH = 1024;

async function createSheetState(): Promise<SheetState> {
	return {
		sheet: await Jimp.create(SHEET_WIDTH, SHEET_ICON_SIZE),
		metadata: new Map(),
		iconCache: new Map(),
		simpleIcons: new Map(),
		pos: 0,
	};
}

/** Grow the spritesheet vertically if needed to fit another row. */
async function growSheet(state: SheetState) {
	const row = Math.floor(state.pos / (SHEET_WIDTH / SHEET_ICON_SIZE));
	const neededHeight = (row + 1) * SHEET_ICON_SIZE;
	if (neededHeight > state.sheet.bitmap.height) {
		const extended = await Jimp.create(SHEET_WIDTH, neededHeight);
		extended.composite(state.sheet, 0, 0);
		(state.sheet as any).bitmap = (extended as any).bitmap;
	}
}

/**
 * Export item icons for a single category onto the shared spritesheet.
 *
 * @param server - The server to load icons from.
 * @param modVersions - Mapping of mod name to version.
 * @param items - Array of item prototypes to export.
 * @param category - Category name for metadata.
 * @param state - Shared spritesheet state (mutated in place).
 * @returns Number of icons exported for this category.
 * @internal
 */
async function exportItems(
	server: FactorioServer,
	modVersions: Map<string, string>,
	items: ItemPrototype[],
	category: string,
	state: SheetState,
) {
	let count = 0;
	for (let item of items) {
		// Skip prototypes with no icon data at all
		if (!item.icons && !item.icon) {
			continue;
		}

		let icon: Jimp | null = null;
		let iconPos: number | undefined;
		if (item.icons) {
			icon = await loadLayeredIcon(
				server, modVersions, item as LayeredIconSpecification, SHEET_ICON_SIZE, state.iconCache,
			);
			iconPos = state.pos;

		} else {
			iconPos = state.simpleIcons.get(item.icon as string);
			if (iconPos === undefined) {
				icon = await loadSimpleIcon(
					server, modVersions, item as SimpleIconSpecification, SHEET_ICON_SIZE, state.iconCache,
				);
				if (icon) {
					iconPos = state.pos;
					state.simpleIcons.set(item.icon as string, state.pos);
				}
			}
		}

		if (iconPos !== undefined) {
			const iconPath = getPrimaryIconPath(item);
			state.metadata.set(item.name, {
				x: iconPos * SHEET_ICON_SIZE % SHEET_WIDTH,
				y: Math.floor(iconPos / (SHEET_WIDTH / SHEET_ICON_SIZE)) * SHEET_ICON_SIZE,
				size: SHEET_ICON_SIZE,
				category,
				...(iconPath ? { path: iconPath } : {}),
			});
		}

		if (icon) {
			await growSheet(state);
			state.sheet.composite(
				icon,
				state.pos * SHEET_ICON_SIZE % SHEET_WIDTH,
				Math.floor(state.pos / (SHEET_WIDTH / SHEET_ICON_SIZE)) * SHEET_ICON_SIZE,
			);
			state.pos += 1;
			count += 1;
		}
	}

	return count;
}

/**
 * Exports the locale files for the base game and the given mods
 *
 * Parses and merges all the locales for the all the mods given through
 * `modVersions` and `modOrder`.
 *
 * @param server - The server to export the locale from.
 * @param modVersions - Mapping of mod name to version to export locale from.
 * @param modOrder - Load order of the mods.
 * @param languageCode - Language to export locale for.
 * @returns merged locale information
 * @internal
 */
async function exportLocale(
	server: FactorioServer,
	modVersions: Map<string, string>,
	modOrder: string[],
	languageCode: string
) {
	let mergedLocales = new Map<string, string>();

	function mergeLocale(locale: Record<string, string | Record<string, string>>) {
		for (let [category, entries] of Object.entries(locale)) {
			if (typeof entries === "string") {
				mergedLocales.set(category, entries);

			} else {
				for (let [key, value] of Object.entries(entries)) {
					mergedLocales.set(`${category}.${key}`, value);
				}
			}
		}
	}

	const builtinModNames = [
		// Filter if on builtin mods so "core" does not need to be specified in modOrder
		"core", ...lib.ModPack.getBuiltinModNames(server.version!).filter(mod => modOrder.includes(mod)),
	];
	for (const builtinModName of builtinModNames) {
		const localeFilePath = server.dataPath(builtinModName, "locale", languageCode, `${builtinModName}.cfg`);
		mergeLocale(lib.parse(await fs.readFile(localeFilePath, "utf8")));
	}

	const builtinModNamesExport = ["export", ...builtinModNames];
	for (let mod of modOrder) {
		if (builtinModNamesExport.includes(mod)) {
			continue;
		}

		let zip;
		try {
			zip = await loadZip(server, modVersions, mod);
		} catch (err: any) {
			if (err.code === "ENOENT") {
				continue;
			}
			throw err;
		}
		for (let file of zip.file(new RegExp(`locale\\/${languageCode}\\/.*\\.cfg`))) {
			let content = await file.async("nodebuffer");
			mergeLocale(lib.parse(content.toString("utf8")));
		}
	}

	return mergedLocales;
}

/**
 * Export the locale and item icons for the given factorio server
 *
 * @param server - The server to export the data from.
 * @returns zip file with exported data.
 */
export async function exportData(server: FactorioServer) {
	await generateExportMod(server);

	let settings: Prototypes = {};
	let prototypes: Prototypes = {};
	let modVersions = new Map();
	let modOrder: string[] = [];

	function add(obj: Prototypes, prototype: Prototype) {
		if (!Object.prototype.hasOwnProperty.call(obj, prototype.type)) {
			obj[prototype.type] = {};
		}
		obj[prototype.type][prototype.name] = prototype;
	}

	server.on("ipc-prototype_export", data => add(prototypes, data));
	server.on("ipc-settings_export", data => add(settings, data));
	server.on("ipc-mod_setting_mod", ({ name, mod }) => {
		for (let type of Object.values(settings)) {
			if (Object.prototype.hasOwnProperty.call(type, name)) {
				type[name].mod = mod;
				return;
			}
		}
		server._logger.error(`Unable to find ${name} in settings prototypes`);
	});
	server.on("ipc-mod_list", data => { modVersions = new Map(Object.entries(data)); });
	server.on("output", parsed => {
		if (parsed.format === "seconds" && parsed.type === "generic") {
			let match = /^Checksum of (.*): \d+$/.exec(parsed.message);
			if (match) {
				modOrder.push(match[1]);
			}
		}
	});

	try {
		await server.startScenario("base/freeplay");
		await server.kill();
	} finally {
		await fs.unlink(server.writePath("mods", "export_0.0.0.zip"));
	}

	if (!Object.keys(prototypes).length) {
		throw new Error("No prototypes got exported");
	}

	// Some mod authors put leading zeros into the versions of their zip files.
	let splitter = /^(.*)_(\d+)\.(\d+)\.(\d+)\.zip?$/;
	for (let entry of await fs.readdir(server.writePath("mods"))) {
		let match = splitter.exec(entry);
		if (!match) {
			continue;
		}

		let modVersion = `${match[2]}.${match[3]}.${match[4]}`;
		let normalizedVersion =
			`${Number.parseInt(match[2], 10)}.${Number.parseInt(match[3], 10)}.${Number.parseInt(match[4], 10)}`
		;

		if (modVersion === normalizedVersion) {
			continue;
		}

		if (modVersions.get(match[1]) === normalizedVersion) {
			modVersions.set(match[1], modVersion);
		}
	}

	const categories: { name: string, types: Set<string> }[] = [
		{ name: "item", types: itemTypes },
		{ name: "recipe", types: recipeTypes },
		{ name: "signal", types: signalTypes },
		{ name: "technology", types: technologyTypes },
		{ name: "planet", types: planetTypes },
		{ name: "quality", types: qualityTypes },
		{ name: "entity", types: entityTypes },
	];

	let locale = await exportLocale(server, modVersions, modOrder, "en");

	// Free up the memory used by zip files loaded during the export.
	zipCache.clear();

	let zip = new JSZip();
	zip.file("export/settings.json", JSON.stringify(settings));
	zip.file("export/prototypes.json", JSON.stringify(prototypes));
	zip.file("export/locale.json", JSON.stringify([...locale.entries()]));

	// Build a single unified spritesheet across all prototype categories + static icons.
	// Track all __mod__/paths already packed so later categories can deduplicate.
	const state = await createSheetState();
	const exportedIconPaths = new Set<string>();
	for (const category of categories) {
		let categoryItems = filterPrototypes(prototypes, category.types);

		// Deduplicate entities: skip any prototype whose primary icon path
		// was already exported by a prior category (items, recipes, signals,
		// etc.), and skip internal prefixed entities (dummy-, hidden-).
		if (category.name === "entity") {
			categoryItems = categoryItems.filter(item => {
				if (item.name.startsWith("dummy-") || item.name.startsWith("hidden-")) {
					return false;
				}
				const iconPath = getPrimaryIconPath(item);
				return !iconPath || !exportedIconPaths.has(iconPath);
			});
		}

		if (categoryItems.length === 0) {
			continue;
		}
		const count = await exportItems(server, modVersions, categoryItems, category.name, state);
		server._logger.info(`Exported ${count} ${category.name} icons`);
		// Record every icon path used so later categories can deduplicate.
		for (const item of categoryItems) {
			if (item.icon) {
				exportedIconPaths.add(item.icon as string);
			}
			for (const layer of (Array.isArray(item.icons) ? item.icons as IconLayer[] : [])) {
				exportedIconPaths.add(layer.icon);
			}
		}
	}

	// Crop sheet to actual used height and write single spritesheet + metadata.
	const usedRows = Math.ceil(state.pos / (SHEET_WIDTH / SHEET_ICON_SIZE));
	state.sheet.crop(0, 0, SHEET_WIDTH, Math.max(usedRows * SHEET_ICON_SIZE, 1));
	zip.file("export/spritesheet.png", await state.sheet.getBufferAsync(Jimp.MIME_PNG));
	zip.file("export/metadata.json", JSON.stringify([...state.metadata.entries()]));

	server._logger.info(`Export complete: ${state.metadata.size} icons on ${usedRows} row(s)`);

	return zip;
}


// For testing only
export const _exportLocale = exportLocale;
