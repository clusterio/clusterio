const assert = require("assert").strict;
const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const Prometheus = require('prom-client');
const jwt = require("jsonwebtoken");

const authenticate = require('lib/authenticate');
const database = require("lib/database");

const routes = require("../routes");


const testSecret = "TestSecretDoNotUse";
authenticate.setAuthSecret(testSecret);

const token = jwt.sign({ id: "api" }, testSecret, { expiresIn: 600 });

describe("clusterioMod endpoints", function() {
	const app = express();
	app.use(bodyParser.json({ limit: '10mb', }));
	app.use(bodyParser.urlencoded({ parameterLimit: 100000, limit: '10mb', extended: true }));
	const config = {
		disableFairItemDistribution: true,
	};
	const items = new database.ItemDatabase();
	const gauge = new Prometheus.Gauge({ name: 'test_gauge', help: "test", labelNames: ['route'] });
	routes.addApiRoutes(app, config, { slaves: new Map() }, items, Prometheus, "test_", gauge);

	let persistentMaster = request(app);
	describe("#POST /api/place", function() {
		it("adds an itemStack to the masters inventory", function() {
			return persistentMaster.post("/api/place").send({
				name:"steel-plate",
				count:20,
				instanceName:"unitTest"
			}).set(
				"X-Access-Token", token
			).expect(200).then(function(res) {
				assert.equal(res.text, "success", "something went wrong with the request")
			});
		});
	});
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
	describe("#POST /api/remove", function() {
		it("returns an itemStack of how many items were removed", function() {
			return persistentMaster.post("/api/remove").send({
				name:"steel-plate",
				count:10
			}).set(
				"X-Access-Token", token
			).expect(200).then(function(res) {
				assert.equal(res.body.count, 10, `Expected 10 steel got ${res.text}`);
			});
		});
		it("works correctly for items named addItem or removeItem", async function() {
			function add(item) {
				return persistentMaster.post("/api/place").send({
					name: item,
					count: 10
				}).set(
					"X-Access-Token", token
				).expect(200).then(function(res) {
					assert.equal(res.text, 'success', `/api/place ${item} failed with ${res.text}`);
				})
			}

			function remove(item) {
				return persistentMaster.post("/api/remove").send({
					name: item,
					count: 10
				}).set(
					"X-Access-Token", token
				).expect(200).then(function(res) {
					assert.deepEqual(res.body, {"name":item,"count":10});
				});
			}

			await Promise.all([add("addItem"), add("removeItem")]);
			await Promise.all([remove("addItem"), remove("removeItem")]);
		});
		it("returns an empty itemStack if you don't have any of the item you request", function() {
			return persistentMaster.post("/api/remove").send({
				name:"imaginaryItem",
				count:999999
			}).set(
				"X-Access-Token", token
			).expect(200).then(function(res) {
				assert.equal(res.body.name, "imaginaryItem", "Make sure body.name is the item we asked for");
				assert.equal(res.body.count, 0, "Count should be 0 since we are asking for something that does not exist anywhere");
				assert.equal(Object.keys(res.body).length, 2, "name and count should be the only keys on this object");
			});
		});
	});
});
