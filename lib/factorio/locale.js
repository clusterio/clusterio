/**
 * Function for parsing factorio locale from a local factorio install
 */

"use strict";
const fs = require("fs-extra");
const path = require("path");
const ini = require("ini");

/**
 * Gets factorios locale as an object, does not respect mods.
 *
 * @param {string} factorioDirectory
 * @param {string} languageCode
 * @param {function} callback
 */
async function getLocale(dataDir, languageCode) {
	if (typeof dataDir !== "string") throw new TypeError("dataDir must be a string");
	if (typeof languageCode !== "string") throw new TypeError("languageCode must be a string");

	let localeFilePath = path.join(dataDir, "base", "locale", languageCode, "base.cfg");
	let content = await fs.readFile(localeFilePath, "utf8");
	return ini.parse(content);
}

module.exports = {
	getLocale,
};
