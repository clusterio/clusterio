/**
 * Shared library for Clusterio
 * @module lib
 */
"use strict";
const libBuildMod = require("./build_mod");
const libCommand = require("./src/command");
const libConfig = require("./src/config");
const libData = require("./src/data");
const libDatabase = require("./src/database");
const libErrors = require("./src/errors");
const libFactorio = require("./src/factorio");
const libFileOps = require("./src/file_ops");
const libHash = require("./src/hash");
const libHelpers = require("./src/helpers");
const libIni = require("./src/ini");
const libLink = require("./src/link");
const libLogging = require("./src/logging");
const libLoggingUtils = require("./src/logging_utils");
const libLuaTools = require("./src/lua_tools");
const libPlugin = require("./src/plugin");
const libPluginLoader = require("./src/plugin_loader");
const libPrometheus = require("./src/prometheus");
const libSchema = require("./src/schema");
const libSharedCommands = require("./src/shared_commands");
const libStream = require("./src/stream");
const libUsers = require("./src/users");
const libZipOps = require("./src/zip_ops");

const ExponentialBackoff = require("./src/ExponentialBackoff");
const PlayerStats = require("./src/PlayerStats");
const RateLimiter = require("./src/RateLimiter");


module.exports = {
	...libBuildMod,
	...libCommand,
	...libConfig,
	...libData,
	...libDatabase,
	...libErrors,
	...libFactorio,
	...libFileOps,
	...libHash,
	...libHelpers,
	...libIni,
	...libLink,
	...libLogging,
	...libLoggingUtils,
	...libLuaTools,
	...libPlugin,
	...libPluginLoader,
	...libPrometheus,
	...libSchema,
	...libSharedCommands,
	...libStream,
	...libUsers,
	...libZipOps,

	ExponentialBackoff,
	PlayerStats,
	RateLimiter,
};
