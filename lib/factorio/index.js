/**
 * Library for interfacing with Factorio Servers and saves.
 * @module lib/factorio
 * @author Hornwitser
 */
module.exports = {
	...require("lib/factorio/export"),
	...require("lib/factorio/patch"),
	...require("lib/factorio/server"),
};
