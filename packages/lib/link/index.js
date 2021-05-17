/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
"use strict";
const link = require("./link");
const messages = require("./messages");
const connectors = require("./connectors");

module.exports = {
	...link,
	...messages,
	...connectors,
};
