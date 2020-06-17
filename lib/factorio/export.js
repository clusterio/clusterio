// Export of item icons and locale
"use strict";
const fs = require("fs-extra");
const path = require("path");
const ini = require("ini");
const Jimp = require("jimp");
const JSZip = require("jszip");

const buildMod = require("../../build-mod");

/**
 * Generate the export mod needed for exportData
 *
 * Packs the lua export mod located in lua/export into the mods folder for
 * the server given, with dependencies generated for all the mods present in
 * the server's mods folder.
 *
 * @param {module:lib/factorio.FactorioServer} server -
 *     The server to generate the export mod for.
 * @memberof module:lib/factorio
 */
async function generateExportMod(server) {
	let dependencies = [];
	let splitter = /^(.*)_(\d+\.\d+\.\d+)(\.zip)?$/;
	for (let entry of await fs.readdir(server.writePath("mods"))) {
		let match = splitter.exec(entry);
		if (match && match[1] !== "export") {
			dependencies.push(`? ${match[1]}`);
		}
	}

	await buildMod.build({
		clean: false,
		build: true,
		pack: true,
		sourceDir: path.join("lua", "export"),
		outputDir: server.writePath("mods"),
		bumpPatch: false,
		factorioVersion: server.version.replace(/\.\d+$/, ""),
		dependencies,
	});
}

let zipCache = new Map();
async function loadZip(server, modVersions, mod) {
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

	return zip.folder(`${mod}_${modVersion}`);
}

/**
 * Load the given Factorio file path into a Buffer
 *
 * @param {module:lib/factorio.FactorioServer} server -
 *     The server to load the file from.
 * @param {Map<string, string>} modVersions - Mapping of mod to version used.
 * @param {string} modPath - Factorio style path to the file to load.
 * @returns {?Buffer} The content of the file or null if not found.
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
async function loadFile(server, modVersions, modPath) {
	let match = /^__([^\/]+)__\/(.*)$/.exec(modPath);
	if (!match) {
		throw new Error(`Bad mod path ${match}`);
	}

	let [, mod, filePath] = match;

	if (["core", "base"].includes(mod)) {
		try {
			return await fs.readFile(server.dataPath(mod, filePath));
		} catch (err) {
			if (err.code === "ENOENT") {
				return null;
			}
			throw err;
		}
	}

	let zip = await loadZip(server, modVersions, mod);
	let file = zip.file(filePath);
	if (!file) {
		return null;
	}

	return await file.async("nodebuffer");
}

/**
 * Export item icons and data
 *
 * Assembles and packs the icons for the item prototypes given into a single
 * spritesheet and json file with meta data.
 *
 * @param {module:lib/factorio.FactorioServer} server -
 *     The server to generate the export mod for.
 * @param {Map<string, string>} modVersions -
 *     Mapping of mod name to versions to get icons from.
 * @param {Array<Object>} items - Array of item prototypes.
 * @return {{itemSheet: Jimp, itemData: Map<string,Object>}}
 *     Item spritesheet and metadata.
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
async function exportItems(server, modVersions, items) {

	// Size to render icons at
	let size = 32;

	// Width of spritesheet
	let width = 1024;

	let rows = Math.ceil(items.length / (width / size));
	let iconSheet = await Jimp.create(width, rows * size);
	let itemData = new Map();
	let pos = 0;

	let iconCache = new Map();
	async function loadIcon(path, iconSize, iconMipmaps) {
		let icon = iconCache.get(path);
		if (icon === undefined) {
			let fileContent = await loadFile(server, modVersions, path);
			if (fileContent) {
				icon = await Jimp.read(fileContent);
				icon.crop(0, 0, iconSize, iconSize);
				iconCache.set(path, icon);
			} else {
				icon = null;
				console.log(`Warning: ${path} not found`);
			}
			iconCache.set(path, icon);
		}
		return icon;
	}

	let simpleIcons = new Map();
	for (let item of items) {
		let icon;
		let iconPos;
		if (item.icons) {
			let baseLayerSize = item.icons[0].icon_size || item.icon_size;
			icon = await Jimp.create(size, size);
			iconPos = pos;

			// The scaling factor of the base layer
			let baseLayerScale = item.icons[0].scale || 32 / baseLayerSize;

			// The size in pixels of one unit
			let baseUnit = size / (baseLayerSize * baseLayerScale);

			for (let layer of item.icons) {
				let layerSize = layer.icon_size || item.icon_size;
				let iconLayer = await loadIcon(layer.icon, layerSize, layer.icon_mipmaps || 0);

				if (!iconLayer) {
					continue;
				}

				iconLayer = iconLayer.clone();

				let tint;
				if (layer.tint) {
					let divisor = (layer.tint.r > 1 || layer.tint.g > 1 || layer.tint.b > 1) ? 255 : 1;
					tint = {
						r: (layer.tint.r || 0) / divisor,
						g: (layer.tint.g || 0) / divisor,
						b: (layer.tint.b || 0) / divisor,
						a: layer.tint.a || 1,
					};
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

				iconLayer.scan(0, 0, iconLayer.bitmap.width, iconLayer.bitmap.height, function(x, y, sidx) {
					x += xs;
					y += ys;
					if (x < 0 || x >= size || y < 0 || y >= size) {
						return;
					}
					let sdata = this.bitmap.data;
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

		} else {
			iconPos = simpleIcons.get(item.icon);
			if (iconPos === undefined) {
				icon = await loadIcon(item.icon, item.icon_size, 0);
				if (icon) {
					iconPos = pos;
					simpleIcons.set(item.icon, pos);
					let iconScale = size / item.icon_size;
					if (iconScale !== 1) {
						icon = icon.clone();
						icon.scale(iconScale);
					}
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
 * @param {module:lib/factorio.FactorioServer} server -
 *     The server to export the locale from.
 * @param {Map<string, string>} modVersions -
 *     Mapping of mod name to version to export locale from.
 * @param {Array<string>} modOrder - Load order of the mods.
 * @param {string} languageCode - Language to export locale for.
 * @returns {Map<string, string>} merged locale information
 * @memberof module:lib/factorio
 * @private
 * @inner
 */
async function exportLocale(server, modVersions, modOrder, languageCode) {
	let mergedLocales = new Map();

	function mergeLocale(locale) {
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

	let baseLocaleFilePath = server.dataPath("base", "locale", languageCode, "base.cfg");
	mergeLocale(ini.parse(await fs.readFile(baseLocaleFilePath, "utf8")));

	for (let mod of modOrder) {
		if (["core", "base", "export"].includes(mod)) {
			continue;
		}

		let zip = await loadZip(server, modVersions, mod);
		for (let file of zip.file(new RegExp(`locale\\/${languageCode}\\/.*\\.cfg`))) {
			let content = await file.async("nodebuffer");
			mergeLocale(ini.parse(content.toString("utf8")));
		}
	}

	return mergedLocales;
}

/**
 * Export the locale and item icons for the given factorio server
 *
 * @param {module:lib/factorio.FactorioServer} server -
 *     The server to export the data from.
 * @returns {JSZip} zip file with exported data.
 * @memberof module:lib/factorio
 */
async function exportData(server) {
	await generateExportMod(server);

	let items = [];
	let modVersions = new Map();
	let modOrder = [];

	server.on("ipc-item_export", data => items.push(data));
	server.on("ipc-mod_list", data => { modVersions = new Map(Object.entries(data)); });
	server.on("output", data => {
		if (data.format === "seconds" && data.type === "generic") {
			let match = /^Checksum of (.*): \d+$/.exec(data.message);
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

	if (!items.length) {
		throw new Error("No items got exported");
	}

	let { iconSheet, itemData } = await exportItems(server, modVersions, items);
	let locale = await exportLocale(server, modVersions, modOrder, "en");

	// Free up the memory used by zip files loaded during the export.
	zipCache.clear();

	let zip = new JSZip();
	zip.file("export/item-spritesheet.png", await iconSheet.getBufferAsync(Jimp.MIME_PNG));
	zip.file("export/item-metadata.json", JSON.stringify([...itemData.entries()]));
	zip.file("export/locale.json", JSON.stringify([...locale.entries()]));
	return zip;
}


module.exports = {
	exportData,

	// For testing only
	_exportLocale: exportLocale,
};
