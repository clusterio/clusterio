/**
 * Shared data types used in Clusterio
 * @module lib/data
 * @author Hornwitser
 */
"use strict";
const ExportManifest = require("./ExportManifest");
const ModInfo = require("./ModInfo");
const ModPack = require("./ModPack");
const version = require("./version");

module.exports = {
	ExportManifest,
	ModInfo,
	ModPack,
	...version,
};
