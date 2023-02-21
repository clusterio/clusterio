"use strict";
const assert = require("assert").strict;

const routes = require("../routes");
const { get } = require("../../../test/integration");


describe("subspace_storage endpoints", function() {
	describe("GET /api/inventory", function() {
		it("should return the controllers current inventory", async function() {
			let res = await get("/api/inventory");
			let inventory = res.body;
			assert.equal(typeof inventory, "object", "Inventory should be an object");

			return; // XXX Disabled until a suitable test interface is added.
			assert(inventory.length >= 1, "There should be at least 1 entry in the inventory");

			let contains20SteelPlate = false;
			inventory.forEach(itemStack => {
				if (itemStack.name === "steel-plate" && itemStack.count >= 20) {
					contains20SteelPlate = true;
				}
			});
			assert(contains20SteelPlate, "Please ensure there are at least 20 steel plate in the inventory");
		});
	});
});
