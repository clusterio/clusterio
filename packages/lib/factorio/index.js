/**
 * Library for interfacing with Factorio Servers and saves.
 * @module lib/factorio
 * @author Hornwitser
 */
"use strict";
module.exports = {
	...require("./export"),
	...require("./patch"),
	...require("./server"),
};
