/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
module.exports = {
	...require('lib/link/link'),
	...require('lib/link/messages'),
	...require('lib/link/connectors'),
};
