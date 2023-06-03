/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
"use strict";
const link = require("./link");
const connectors = require("./connectors");

module.exports = {
	...link,
	...connectors,

	// migrate: Allow info for plugins from before link refactor to load.
	Event: class Event {},
	Request: class Request {},
};
