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
	Event: class Event {},
	Request: class Request {},
};
