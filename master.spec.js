const app = require('./master.js');
const config = require('./config.json');
const assert = require('assert').strict;
const request = require('supertest');
const validateHTML = require('html5-validator');
const parallel = require('mocha.parallel');
const jwt = require("jsonwebtoken");


const token =
	jwt.sign( { id: "api" }, config.masterAuthSecret, { expiresIn: 600 });

async function get(path) {
	return await request(app).get(path).expect(200);
}

async function getValidate(path) {
	let res = await get(path);
	let validation = await validateHTML(res.text);
	let filtered = validation.messages.filter(msg => msg.type !== "info");
	assert(filtered.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(validation.messages, null, 4));
}

describe('Master server endpoint testing', function() {
	describe('#GET /api/getFactorioLocale', function() {
		it('should get the basegame factorio locale', async function() {
			let res = await get('/api/getFactorioLocale');
			let object = res.body;

			// test that it is looks like a factorio locale
			assert.equal(typeof object, "object");
			assert.equal(object["entity-name"]["fish"], "Fish");
			assert.equal(object["entity-name"]["small-lamp"], "Lamp");
		});
	});
	// describe("#GET /api/")
	parallel("#GET static website data", function() {
		this.timeout(6000);

		let paths = ["/", "/nodes", "/settings", "/nodeDetails", "/remoteMap"];
		for (let path of paths) {
			it(`sends some HTML when accessing ${path}`, () => getValidate(path));
		}
	});
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
		it("returns an empty itemStack if you try to request addItem or removeItem", function() {
			function remove() {
				return persistentMaster.post("/api/remove").send({
					name:"addItem",
					count:10
				}).set(
					"X-Access-Token", token
				).expect(200).then(function(res) {
					assert.equal(res.text, '{"name":"addItem","count":0}', "When there are none of the item, you should get 0 back. addItem and removeItem should always return 0");
				});
			}

			return Promise.all([remove(), remove()]);
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
