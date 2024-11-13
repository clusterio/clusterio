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
	icon_size: number;
	icon_mipmaps?: number;
}
interface IconLayer {
	icon: string;
	icon_size: number;
	tint?: lib.FactorioColor,
	shift?: [number, number],
	scale?: number,
	icon_mipmaps?: number,
}
interface LayeredIconSpecification {
	icons: IconLayer[];
	icon_size: number;
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
		throw new Error(`Bad mod path ${match}`);
	}

	let [, mod, filePath] = match;

	const builtinMods = lib.ModPack.getBuiltinMods(server.version!);
	if (builtinMods.some(builtinMod => builtinMod.name === mod)) {
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
			server._logger.warn(`${iconPath} not found`);
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
	let icon = await loadIcon(server, modVersions, item.icon, item.icon_size, 0, iconCache);
	if (icon) {
		let iconScale = size / item.icon_size;
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
	let baseLayerSize = item.icons[0].icon_size || item.icon_size;
	let icon = await Jimp.create(size, size);

	// The scaling factor of the base layer
	let baseLayerScale = item.icons[0].scale || 32 / baseLayerSize;

	// The size in pixels of one unit
	let baseUnit = size / (baseLayerSize * baseLayerScale);

	for (let layer of item.icons) {
		let layerSize = layer.icon_size || item.icon_size;
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

		// eslint-disable-next-line no-loop-func
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
	// TODO consider adding virtual signals and recipes
]);

function filterItems(prototypes: Prototypes): ItemPrototype[] {
	return Object.entries(prototypes)
		.filter(([type, _]) => itemTypes.has(type))
		.flatMap(([_, typePrototypes]) => Object.values(typePrototypes) as ItemPrototype[])
		.map(fixIcons)
	;
}

/**
 * Export item icons and data
 *
 * Assembles and packs the icons for the item prototypes given into a single
 * spritesheet and json file with meta data.
 *
 * @param server -
 *     The server to generate the export mod for.
 * @param modVersions -
 *     Mapping of mod name to versions to get icons from.
 * @param items - Array of item prototypes.
 * @return Item spritesheet and metadata.
 * @internal
 */
async function exportItems(server: FactorioServer, modVersions: Map<string, string>, items: ItemPrototype[]) {

	// Size to render icons at
	let size = 32;

	// Width of spritesheet
	let width = 1024;

	let rows = Math.ceil(items.length / (width / size));
	let iconSheet = await Jimp.create(width, rows * size);
	let itemData = new Map();
	let pos = 0;

	let iconCache: IconCache = new Map();
	let simpleIcons = new Map();
	for (let item of items) {
		let icon: Jimp | null = null;
		let iconPos: number | undefined;
		if (item.icons) {
			icon = await loadLayeredIcon(server, modVersions, item as LayeredIconSpecification, size, iconCache);
			iconPos = pos;

		} else {
			iconPos = simpleIcons.get(item.icon);
			if (iconPos === undefined) {
				icon = await loadSimpleIcon(server, modVersions, item as SimpleIconSpecification, size, iconCache);
				if (icon) {
					iconPos = pos;
					simpleIcons.set(item.icon, pos);
				}
			}
		}

		if (iconPos !== undefined) {
			itemData.set(item.name, {
				x: iconPos * size % width,
				y: Math.floor(iconPos / (width / size)) * size,
				size,
				localised_name: item.localised_name,
				localised_description: item.localised_description,
			});
		}

		if (icon) {
			iconSheet.composite(icon, pos * size % width, Math.floor(pos / (width / size)) * size);
			pos += 1;
		}
	}

	iconSheet.crop(0, 0, width, Math.ceil(pos / (width / size)) * size);

	return { iconSheet, itemData };
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

	const builtinMods = lib.ModPack.getBuiltinMods(server.version!);
	for (const builtinMod of builtinMods) {
		const localeFilePath = server.dataPath(builtinMod.name, "locale", languageCode, `${builtinMod.name}.cfg`);
		mergeLocale(lib.parse(await fs.readFile(localeFilePath, "utf8")));
	}

	const builtinModNames = ["export", ...builtinMods.map(builtinMod => builtinMod.name)];
	for (let mod of modOrder) {
		if (builtinModNames.includes(mod)) {
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

	let { iconSheet, itemData } = await exportItems(server, modVersions, filterItems(prototypes));
	let locale = await exportLocale(server, modVersions, modOrder, "en");

	// Free up the memory used by zip files loaded during the export.
	zipCache.clear();

	let zip = new JSZip();
	zip.file("export/settings.json", JSON.stringify(settings));
	zip.file("export/prototypes.json", JSON.stringify(prototypes));
	zip.file("export/item-spritesheet.png", await iconSheet.getBufferAsync(Jimp.MIME_PNG));
	zip.file("export/item-metadata.json", JSON.stringify([...itemData.entries()]));
	zip.file("export/locale.json", JSON.stringify([...locale.entries()]));
	return zip;
}


// For testing only
export const _exportLocale = exportLocale;
