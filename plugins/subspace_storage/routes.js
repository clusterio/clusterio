"use strict";
const express = require("express");
const path = require("path");

const prometheus = require("@clusterio/lib/prometheus");


function addApiRoutes(app, items, endpointHitCounter) {

	/**
	 * GET endpoint to read the masters current inventory of items.
	 *
	 * @memberof clusterioMaster
	 * @instance
	 * @alias api/inventory
	 * @returns {object[]} JSON [{name:"iron-plate", count:100},{name:"copper-plate",count:5}]
	 */
	app.get("/api/inventory", function(req, res) {
		endpointHitCounter.labels(req.route.path).inc();
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// Check it and send it
		var inventory = [];
		for (let [name, count] of items._items) {
			inventory.push({ name, count });
		}
		res.type("json");
		res.send(JSON.stringify(inventory));
	});

	/**
	 * GET endpoint to read the masters inventory as an object with key:value pairs
	 *
	 * @memberof clusterioMaster
	 * @instance
	 * @alias api/inventoryAsObject
	 * @returns {object} JSON {"iron-plate":100, "copper-plate":5}
	 */
	app.get("/api/inventoryAsObject", function(req, res) {
		endpointHitCounter.labels(req.route.path).inc();
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// Check it and send it
		res.type("json");
		res.send(JSON.stringify(items.serialise()));
	});
}

module.exports = {
	addApiRoutes,
};
