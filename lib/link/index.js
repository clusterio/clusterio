/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
"use strict";
module.exports = {
	...require("lib/link/link"),
	...require("lib/link/messages"),
	...require("lib/link/connectors"),
};
