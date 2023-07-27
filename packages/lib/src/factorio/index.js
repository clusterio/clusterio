/**
 * Library for interfacing with Factorio Servers and saves.
 * @module lib/factorio
 * @author Hornwitser
 */
"use strict";
const exchange_string = require("./exchange_string");
const export_ = require("./export");
const patch = require("./patch");
const server = require("./server");

module.exports = {
	...exchange_string,
	...export_,
	...patch,
	...server,
};
