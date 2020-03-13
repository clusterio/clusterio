const assert = require("assert").strict;
const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const authenticate = require('lib/authenticate');
const database = require("lib/database");
const prometheus = require("lib/prometheus");

const routes = require("../routes");


const testSecret = "TestSecretDoNotUse";
authenticate.setAuthSecret(testSecret);

const token = jwt.sign({ id: "api" }, testSecret, { expiresIn: 600 });

describe("subspace_storage endpoints", function() {
	const app = express();
	app.use(bodyParser.json({ limit: '10mb', }));
	app.use(bodyParser.urlencoded({ parameterLimit: 100000, limit: '10mb', extended: true }));
	const items = new database.ItemDatabase();
	items.addItem("steel-plate", 20);
	const gauge = new prometheus.Gauge("test_gauge", "test", { labels: ["route"] });
	routes.addApiRoutes(app, items, gauge);

	let persistentMaster = request(app);
	describe("#GET /api/inventory", function() {
		it("returns the masters current inventory", function() {
			return persistentMaster.get("/api/inventory").expect(200).then(function(res) {
				let inventory = JSON.parse(res.text);
				assert.equal(typeof inventory, "object", "Inventory should be an object");
				assert(inventory.length >= 1, "There should be at least 1 entry in the inventory");

				let contains20SteelPlate = false;
				inventory.forEach(itemStack => {
					if(itemStack.name == "steel-plate" && itemStack.count >= 20) contains20SteelPlate = true;
				});
				assert(contains20SteelPlate, "Please ensure there are at least 20 steel plate in the inventory")
			});
		});
	});
});
