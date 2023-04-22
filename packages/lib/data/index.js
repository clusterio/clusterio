/**
 * Shared data types used in Clusterio
 * @module lib/data
 * @author Hornwitser
 */
"use strict";
const ExportManifest = require("./ExportManifest");
const ModInfo = require("./ModInfo");
const ModPack = require("./ModPack");
const composites = require("./composites");
const messagesCore = require("./messages_core");
const messagesController = require("./messages_controller");
const messagesHost = require("./messages_host");
const messagesInstance = require("./messages_instance");
const messagesMod = require("./messages_mod");
const messagesUser = require("./messages_user");
const version = require("./version");

module.exports = {
	ExportManifest,
	ModInfo,
	ModPack,
	...composites,
	...messagesCore,
	...messagesController,
	...messagesHost,
	...messagesInstance,
	...messagesMod,
	...messagesUser,
	...version,
};
