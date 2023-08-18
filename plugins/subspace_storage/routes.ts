import type { Application, Request, Response } from "express";
import * as lib from "@clusterio/lib";

export function addApiRoutes(app: Application, items: lib.ItemDatabase) {

	/**
	 * GET endpoint to read the controllers current inventory of items.
	 *
	 * @memberof clusterioController
	 * @instance
	 * @alias api/inventory
	 * @returns {object[]} JSON [{name:"iron-plate", count:100},{name:"copper-plate",count:5}]
	 */
	app.get("/api/inventory", (req: Request, res: Response) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// Check it and send it
		let inventory = [];
		for (let [name, count] of items.getEntries()) {
			inventory.push({ name, count });
		}
		res.type("json");
		res.send(JSON.stringify(inventory));
	});

	/**
	 * GET endpoint to read the controllers inventory as an object with key:value pairs
	 *
	 * @memberof clusterioController
	 * @instance
	 * @alias api/inventoryAsObject
	 * @returns {object} JSON {"iron-plate":100, "copper-plate":5}
	 */
	app.get("/api/inventoryAsObject", (req: Request, res: Response) => {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// Check it and send it
		res.type("json");
		res.send(JSON.stringify(items.serialize()));
	});
}
