/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
"use strict";
module.exports = {
	...require("./link"),
	...require("./messages"),
	...require("./connectors"),
};
