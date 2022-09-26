/**
 * Shared data types used in Clusterio
 * @module lib/data
 * @author Hornwitser
 */
"use strict";
const ModInfo = require("./ModInfo");
const ModPack = require("./ModPack");
const version = require("./version");

module.exports = {
	ModInfo,
	ModPack,
	...version,
};
