var recievedItemStatisticsBySlaveID = {};
var sentItemStatisticsBySlaveID = {};

const averagedTimeSeries = require("averaged-timeseries");
const express = require("express");
const path = require("path");

const authenticate = require("lib/authenticate");

const dole = require("./dole");


function addWebRoutes(app) {
	app.use('/clusterioMod', express.static(path.join(__dirname, 'static')));
	app.get('/clusterioMod/storage', (req, res) => { res.render('clusterioMod/views/storage'); });
}

function addApiRoutes(
	app, config, db, items, Prometheus, prometheusPrefix, endpointHitCounter,
) {
	const prometheusExportGauge = new Prometheus.Gauge({
		name: prometheusPrefix+'export_gauge',
		help: 'Items exported by instance',
		labelNames: ["instanceID", "itemName"],
	});
	const prometheusImportGauge = new Prometheus.Gauge({
		name: prometheusPrefix+'import_gauge',
		help: 'Items imported by instance',
		labelNames: ["instanceID", "itemName"],
	});
	const prometheusDoleFactorGauge = new Prometheus.Gauge({
		name: prometheusPrefix+'dole_factor_gauge',
		help: 'The current dole division factor for this item',
		labelNames: ["itemName"],
	});

	// Only initialize neural network when it's enabled, otherwise it might override gauge
	let neuralDole;
	if(config.useNeuralNetDoleDivider) {
		neuralDole=new dole.neuralDole({
			db, gaugePrefix: prometheusPrefix
		});
	}

	/**
	 * POST endpoint for storing items in master's inventory.

	 * @memberof clusterioMaster
	 * @instance
	 * @alias api/place
	 * @param {itemStack} itemStack the number and type of items to store (see typedef)
	 * @param {string} [itemStack.instanceID="unknown"]
	 *     the unique/instanceID which is a numerical value for an instance
	 * @param {string} [itemStack.instanceName="unknown"]
	 *     the name of an instance for identification in statistics, as
	 *     provided when launching it. ex node client start [name]
	 * @returns {string} status either "success" or "failure"
	 */
	app.post("/api/place", authenticate.middleware, function(req, res) {
		endpointHitCounter.labels(req.route.path).inc();
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		let x;
		try {
			x = JSON.parse(req.body);
		} catch (e) {
			x = req.body;
		}
		if(!x.instanceName) {
			x.instanceName = "unknown";
		}
		if(!x.instanceID) {
			x.instanceID = "unknown";
			for (let [instanceID, slave] of db.slaves) {
				if(slave.instanceName == req.body.instanceName) {
					x.instanceID = instanceID;
					break;
				}
			}
		}
		if(x.instanceID
		&& x.instanceName
		&& !isNaN(Number(x.count))
		&& x.name
		&& typeof x.name == "string"){
			if(config.logItemTransfers){
				console.log("added: " + req.body.name + " " + req.body.count+" from "+x.instanceName+" ("+x.instanceID+")");
			}
			// gather statistics
			let recievedItemStatistics = recievedItemStatisticsBySlaveID[x.instanceID];
			if(recievedItemStatistics === undefined){
				recievedItemStatistics = new averagedTimeSeries({
					maxEntries: config.itemStats.maxEntries,
					entriesPerSecond: config.itemStats.entriesPerSecond,
					mergeMode: "add",
				});
				recievedItemStatisticsBySlaveID[x.instanceID] = recievedItemStatistics;
			}
			recievedItemStatistics.add({
				key:req.body.name,
				value:req.body.count,
			});
			prometheusExportGauge.labels(x.instanceID, req.body.name).inc(Number(req.body.count) || 0);
			// save items we get
			var count = Number(req.body.count);
			items.addItem(req.body.name, count);

			// Attempt confirming
			res.send("success");
		} else {
			res.send("failure");
		}
	});

	/**
	 * POST endpoint to remove items from DB when client orders items.
	 *
	 * @memberof clusterioMaster
	 * @instance
	 * @alias api/remove
	 * @param {itemStack} itemStack the name of and the number of items to remove (see typedef)
	 * @param {string} [itemStack.instanceID="unknown"]
	 *     the unique/instanceID which is a numerical value for an instance
	 * @param {string} [itemStack.instanceName="unknown"]
	 *     the name of an instance for identification in statistics, as
	 *     provided when launching it. ex node client start [name]
	 * @returns {itemStack}
	 *     the number of items actually removed, may be lower than what was
	 *     asked for due to shortages.
	 */
	app.post("/api/remove", authenticate.middleware, function(req, res) {
		endpointHitCounter.labels(req.route.path).inc();
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
		// save items we get
		var object = req.body;
		if(!object.instanceID) {
			object.instanceID = "unknown"
		}
		if(!object.instanceName) {
			object.instanceName = "unknown";
		}
		if (db.slaves.has(String(object.instanceID))) {
			object.instanceName = db.slaves.get(String(object.instanceID)).instanceName;
		}
		let itemCount = items.getItemCount(object.name);
		if (
			(config.disableImportsOfEverythingExceptElectricity === true || config.disableImportsOfEverythingExceptElectricity === "true" )
			&& object.name != "electricity"
		) {
			if(config.logItemTransfers){
				console.log('failure could not find ' + object.name);
			}
			res.send({name:object.name, count:0});
		} else if(config.disableFairItemDistribution){
			// Give out as much items as possible until there are 0 left. This might lead to one slave getting all the items and the rest nothing.
			let numberToRemove = Math.min(Math.abs(Number(object.count)),itemCount);
			items.removeItem(object.name, numberToRemove);
			res.send({count: numberToRemove, name: object.name});

			// track statistics and do graphing things
			prometheusImportGauge.labels(object.instanceID, object.name).inc(Number(numberToRemove) || 0);
			let sentItemStatistics = sentItemStatisticsBySlaveID[object.instanceID];
			if(sentItemStatistics === undefined){
				sentItemStatistics = new averagedTimeSeries({
					maxEntries: config.itemStats.maxEntries,
					entriesPerSecond: config.itemStats.entriesPerSecond,
					mergeMode: "add",
				});
			}
			sentItemStatistics.add({
				key:object.name,
				value:numberToRemove,
			});
			//console.log(sentItemStatistics.data)
			sentItemStatisticsBySlaveID[object.instanceID] = sentItemStatistics;
		} else if(config.useNeuralNetDoleDivider){
			// use fancy neural net to calculate a "fair" dole division rate.
			neuralDole.divider({
				res,
				object,
				config,
				sentItemStatisticsBySlaveID,
				prometheusImportGauge
			})
		} else {
			// Use dole division. Makes it really slow to drain out the last little bit.
			dole.doleDivider({
				itemCount,
				object,
				db,
				sentItemStatisticsBySlaveID,
				config,
				prometheusDoleFactorGauge,
				prometheusImportGauge,
				req,res,
			})
		}
	});

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
		res.send(JSON.stringify(items.serialise()));
	});
}

module.exports = {
	addWebRoutes,
	addApiRoutes,
}
