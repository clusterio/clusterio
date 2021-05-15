/**
 * Library for interfacing with Factorio Servers and saves.
 * @module lib/factorio
 * @author Hornwitser
 */
"use strict";
const export_ = require("./export");
const patch = require("./patch");
const server = require("./server");

module.exports = {
	...export_,
	...patch,
	...server,
};
