"use strict";
const p = require("phin");
const cheerio = require("cheerio");

/**
 * @typedef {Object} Version
 * @property {string} download_url - URL to download the version
 * @property {string} version - version number
 * @property {string} type "headless" or "alpha"
 * @property {string} platform "linux64", "win64", "win64-manual" or "osx"
 */

/**
 * Get versions of Factorio available for download from the official website
 * @returns {Promise<Version[]>} List of versions available for download
 */
async function getAvailableVersions() {
	let page = await p({
		url: "https://www.factorio.com/download/archive",
		method: "GET",
	});
	let $ = cheerio.load(page.body);
	let versions = [];
	$("div.panel.pb0 > div.panel-inset-lighter.pb0")
		.find(".button-green.download-square")
		.filter((i, el) => el.attribs.href !== "/buy")
		.filter((i, el) => !el.attribs.href.includes("demo"))
		.each((i, el) => {
			versions.push({
				download_url: `https://www.factorio.com${el.attribs.href}`,
				version: el.attribs.href.split("/")[2],
				type: el.attribs.href.split("/")[3],
				platform: el.attribs.href.split("/")[4],
			});
		});
	return versions;
};

module.exports = getAvailableVersions;
