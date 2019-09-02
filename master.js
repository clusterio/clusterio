/**
Clusterio master server. Facilitates communication between slaves through
a webserver, storing data related to slaves like production graphs and
combinator signals.

@module clusterioMaster
@author Danielv123

@example
node master.js
*/

// Attempt updating
// const updater = require("./updater.js");
// updater.update().then(console.log);

// argument parsing
const args = require('minimist')(process.argv.slice(2));

const averagedTimeSeries = require("averaged-timeseries");
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs-extra");
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const base64url = require('base64url');
const moment = require("moment");
const request = require("request");

// constants
console.log(`Requiring config from ${args.config || './config'}`);
const config = require(args.config || './config');

// homebrew modules
const generateSSLcert = require("lib/generateSSLcert");
const getFactorioLocale = require("lib/getFactorioLocale");

// homemade express middleware for token auth
const authenticate = require("lib/authenticate")(config);

const express = require("express");
const compression = require('compression');
const cookieParser = require('cookie-parser');
const ejs = require("ejs");
// Required for express post requests
const bodyParser = require("body-parser");
const fileUpload = require('express-fileupload');
var app = express();

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	parameterLimit: 100000,
	limit: '10mb',
	extended: true
}));
app.use(fileUpload());
app.use(compression());

// dynamic HTML generations with EJS
app.set('views', path.join(__dirname, 'static'));
app.set('view engine', 'html');
app.engine('html', ejs.renderFile);

// give ejs access to some interesting information
app.use(function(req, res, next){
	res.locals.res = res;
	res.locals.req = req;
	res.locals.masterPlugins = masterPlugins;
	res.locals.slaves = slaves;
	res.locals.moment = moment;
	next();
});

require("./routes.js")(app);
require("./routes/api/getPictures.js")(app);
// Set folder to serve static content from (the website)
app.use(express.static('static'));

// set up logging software
const prometheusPrefix = "clusterio_";
const Prometheus = require('prom-client');
const expressPrometheus = require('express-prometheus-request-metrics');
Prometheus.collectDefaultMetrics({ timeout: 10000 }); // collects RAM usage etc every 10 s

// collect express request durations ms
app.use(expressPrometheus(Prometheus));

const endpointHitCounter = new Prometheus.Gauge({
	name: prometheusPrefix+'endpoint_hit_gauge',
	help: "How many requests a particular endpoint has gotten",
	labelNames: ['route'],
});
const prometheusConnectedInstancesCounter = new Prometheus.Gauge({
	name: prometheusPrefix+'connected_instaces_gauge',
	help: "How many instances are currently connected to this master server",
});
const prometheusWsUsageCounter = new Prometheus.Counter({
	name: prometheusPrefix+'websocket_usage_counter',
	help: 'Websocket traffic',
	labelNames: ["connectionType", "instanceID"],
});
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
const prometheusPlayerCountGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'player_count_gauge',
	help: 'Amount of players connected to this cluster',
	labelNames: ["instanceID", "instanceName"],
});
const prometheusUPSGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'UPS_gauge',
	help: 'UPS of the current server',
	labelNames: ["instanceID", "instanceName"],
});
const prometheusMasterInventoryGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'master_inventory_gauge',
	help: 'Amount of items stored on master',
	labelNames: ["itemName"],
});
/**
GET Prometheus metrics endpoint. Returns performance and usage metrics in a prometheus readable format.
@memberof clusterioMaster
@instance
@alias /metrics
*/
app.get('/metrics', (req, res) => {
	endpointHitCounter.labels(req.route.path).inc();
	res.set('Content-Type', Prometheus.register.contentType);

	/// gather some static metrics
	registerMoreMetrics();
	res.end(Prometheus.register.metrics());
});

function registerMoreMetrics(){
	for(let instanceID in slaves){
		// playercount
		try{
			prometheusPlayerCountGauge.labels(instanceID, slaves[instanceID].instanceName).set(Number(slaves[instanceID].playerCount) || 0);
		}catch(e){}
		// UPS
		try{
			prometheusUPSGauge.labels(instanceID, slaves[instanceID].instanceName).set(Number(slaves[instanceID].meta.UPS) || 60);
			if(slaves[instanceID].meta.tick && typeof slaves[instanceID].meta.tick === "number") prometheusUPSGauge.labels(instanceID, slaves[instanceID].instanceName).set(Number(slaves[instanceID].meta.tick) || 0);
		}catch(e){}
	}
	// inventory
	for(let key in db.items){
		if(typeof db.items[key] == "number" || typeof db.items[key] == "string"){
			prometheusMasterInventoryGauge.labels(key).set(Number(db.items[key]) || 0);
		}
	}
	// Slave count
	let numberOfActiveSlaves = 0;
	for(let instance in slaves){
		if(Date.now() - Number(slaves[instance].time) < 1000 * 30) numberOfActiveSlaves++;
	}
	prometheusConnectedInstancesCounter.set(numberOfActiveSlaves);
}

// set up database
const db = {};

(function(){
	try{
		let x = fs.statSync(path.resolve(config.databaseDirectory, "slaves.json"));
		console.log(`loading slaves from path.resolve(config.databaseDirectory, "slaves.json")`);
		slaves = JSON.parse(fs.readFileSync(path.resolve(config.databaseDirectory, "slaves.json")));
	} catch (e){
		slaves = {};
	}
	try{
		x = fs.statSync(path.resolve(config.databaseDirectory, "items.json"));
		console.log(`loading items from ${path.resolve(config.databaseDirectory, "items.json")}`);
		db.items = JSON.parse(fs.readFileSync(path.resolve(config.databaseDirectory, "items.json")));
	} catch (e){
		db.items = {};
	}
})();

db.items.addItem = function(object) {
	if(object.name == "addItem" || object.name == "removeItem") {
		console.error("Fuck you, that would screw everything up if you named your item that.");
		return false;
	} else {
		if(this[object.name] && Number(this[object.name]) != NaN){
			this[object.name] = Number(this[object.name]) + Number(object.count);
		} else {
			this[object.name] = Number(object.count);
		}
		return true;
	}
};
db.items.removeItem = function(object) {
	if(object.name == "addItem" || object.name == "removeItem") {
		console.error("Fuck you, that would screw everything up if you named your item that.");
		return false;
	} else {
		if(this[object.name] && Number(this[object.name]) != NaN){
			this[object.name] = Number(this[object.name]) - Number(object.count);
		} else {
			this[object.name] = 0;
		}
		return true;
	}
};

// store slaves and inventory in a .json full of JSON data
async function shutdown() {
	console.log('Ctrl-C...');
	let exitStartTime = Date.now();
	try {
		// set insane limit to slave length, if its longer than this we are probably being ddosed or something
		if(slaves && Object.keys(slaves).length < 2000000){
			console.log("saving to slaves.json");
			fs.writeFileSync(path.resolve(config.databaseDirectory, "slaves.json"), JSON.stringify(slaves));
		} else if(slaves) {
			console.log("Slave database too large, not saving ("+Object.keys(slaves).length+")");
		}
		if(db.items && Object.keys(db.items).length < 50000){
			console.log("saving to items.json");
			fs.writeFileSync(path.resolve(config.databaseDirectory, "items.json"), JSON.stringify(db.items));
		} else if(slaves) {
			console.log("Item database too large, not saving ("+Object.keys(slaves).length+")");
		}
		for(let i in masterPlugins){
			let plugin = masterPlugins[i];
			if(plugin.main && plugin.main.onExit && typeof plugin.main.onExit == "function"){
				let startTime = Date.now();
				await plugin.main.onExit();
				console.log("Plugin "+plugin.pluginConfig.name+" exited in "+(Date.now()-startTime)+"ms");
			}
		}
		console.log("Clusterio cleanly exited in "+(Date.now()-exitStartTime)+"ms");
		process.exit(0);
	} catch(e) {
		console.log(e);
		console.log("Clusterio failed to exit cleanly. Time elapsed: "+(Date.now()-exitStartTime)+"ms");
		process.exit(1)
	}
}

/**
POST World ID management. Slaves post here to tell the server they exist
@memberof clusterioMaster
@instance
@alias /api/getID
*/
app.post("/api/getID", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	// request.body should be an object
	// {rconPort, rconPassword, serverPort, mac, time}
	// time us a unix timestamp we can use to check for how long the server has been unresponsive
	// we should save that somewhere and give appropriate response
	if(req.body){
		if(!slaves[req.body.unique]){
			slaves[req.body.unique] = {};
		}
		for(k in req.body){
			if(k != "meta" && req.body.hasOwnProperty(k)){
				slaves[req.body.unique][k] = req.body[k];
			}
		}
		// console.log("Slave registered: " + slaves[req.body.unique].mac + " : " + slaves[req.body.unique].serverPort+" at " + slaves[req.body.unique].publicIP + " with name " + slaves[req.body.unique].instanceName);
	}
});
/**
POST Allows you to add metadata related to slaves for other tools, like owner data, descriptions or statistics.
@memberof clusterioMaster
@instance
@alias /api/editSlaveMeta
*/
app.post("/api/editSlaveMeta", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	// request.body should be an object
	// {instanceID, pass, meta:{x,y,z}}

	if(req.body && req.body.instanceID && req.body.meta){
		if(slaves[req.body.instanceID]){
			if(!slaves[req.body.instanceID].meta) {
				slaves[req.body.instanceID].meta = {};
			}
			slaves[req.body.instanceID].meta = deepmerge(slaves[req.body.instanceID].meta, req.body.meta, {clone:true});
			let metaPortion = JSON.stringify(req.body.meta);
			if(metaPortion.length > 50) {
				metaPortion = metaPortion.substring(0,20) + "...";
			}
			// console.log("Updating slave "+slaves[req.body.instanceID].instanceName+": " + slaves[req.body.instanceID].mac + " : " + slaves[req.body.instanceID].serverPort+" at " + slaves[req.body.instanceID].publicIP, metaPortion);
			res.sendStatus(200);
		} else {
			res.send("ERROR: Invalid instanceID or password")
		}
	}
});

/**
POST Get metadata from a single slave. For whenever you find the data returned by /api/slaves overkill.
@memberof clusterioMaster
@instance
@alias /api/getSlaveMeta
*/
app.post("/api/getSlaveMeta", function (req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	console.log("body", req.body);
	if(req.body && req.body.instanceID){
		if (slaves[req.body.instanceID]) {
			console.log("returning meta for ", req.body.instanceID);
			if(!slaves[req.body.instanceID].meta) {
				slaves[req.body.instanceID].meta = {};
			}
			res.send(JSON.stringify(slaves[req.body.instanceID].meta))
		} else {
			res.status(404);
			res.send('{"status": 404, "info": "Slave not registered"}')
		}
	} else {
		res.status(400);
		res.send('{"INVALID_REQUEST":1}');
	}
});
// mod management
// should handle uploading and checking if mods are uploaded
/**
POST Check if a mod has been uploaded to the master before. Only checks against filename, not hash.
@memberof clusterioMaster
@instance
@alias /api/checkMod
*/
app.post("/api/checkMod", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let files = fs.readdirSync(path.join(config.databaseDirectory, "masterMods"));
	let found = false;
	files.forEach(file => {
		if(file == req.body.modName) {
			found = true;
		}
	});
	if(!found) {
		// we don't have mod, plz send
		res.send(req.body.modName);
	} else {
		res.send("found");
	}
	res.end();
});
/**
POST endpoint for uploading mods to the master server. Required for automatic mod downloads with factorioClusterioClient (electron app, see seperate repo)
@memberof clusterioMaster
@instance
@alias /api/uploadMod
*/
app.post("/api/uploadMod", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	if (req.files && req.files.file) {
		// console.log(req.files.file);
		req.files.file.mv(path.resolve(config.databaseDirectory, "masterMods", req.files.file.name), function(err) {
			if (err) {
				res.status(500).send(err);
			} else {
				res.send('File uploaded!');
				console.log("Uploaded mod: " + req.files.file.name);
			}
		});
	} else {
		res.send('No files were uploaded.');

	}
});
/**
Prepare the slaveCache for both /api/slaves calls
*/
let slaveCache = {
	timestamp: Date.now(),
};
function getSlaves() {
	if(!slaveCache.cache || Date.now() - slaveCache.timestamp > 5000) {
		let copyOfSlaves = JSON.parse(JSON.stringify(slaves));
		slaveCache.cache = copyOfSlaves;
		slaveCache.timestamp = Date.now();
	}
	return slaveCache;
}
/**
GET endpoint for getting information about all our slaves
@memberof clusterioMaster
@instance
@alias /api/slaves
*/
app.get("/api/slaves", function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	let slaveCache = getSlaves();
	for(key in slaveCache.cache) {
		slaveCache.cache[key].rconPassword = "hidden";
	}
	res.send(slaveCache.cache);
});
/**
POST endpoint for getting the rconPasswords of all our slaves
@memberof clusterioMaster
@instance
@alias /api/rconPasswords
*/
app.post("/api/rconPasswords", authenticate.middleware, function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	let slaveCache = getSlaves();
	let validKeys = ['rconPort', 'rconPassword', 'publicIP'];
	for(key in slaveCache.cache) {
		slaveCache.cache[key] = {'publicIP': slaveCache.cache[key].publicIP, 'rconPort': slaveCache.cache[key].rconPort, 'rconPassword': slaveCache.cache[key].rconPassword};
	}
	res.send(slaveCache.cache);
});
/*
var recievedItemStatistics = new averagedTimeSeries({
	maxEntries: config.itemStats.maxEntries,
	entriesPerSecond: config.itemStats.entriesPerSecond,
}, console.log);*/
var recievedItemStatisticsBySlaveID = {};
var sentItemStatisticsBySlaveID = {};
// 
/**
POST endpoint for storing items in master's inventory.

@memberof clusterioMaster
@instance
@alias api/place
@param {itemStack} itemStack the number and type of items to store (see typedef)
@param {string} [itemStack.instanceID="unknown"] the unique/instanceID which is a numerical value for an instance
@param {string} [itemStack.instanceName="unknown"] the name of an instance for identification in statistics, as provided when launching it. ex node client.js start [name]
@returns {string} status either "success" or "failure"
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
		Object.keys(slaves).forEach(instanceID => {
			if(slaves[instanceID].instanceName == req.body.instanceName) {
				x.instanceID = instanceID;
			}
		});
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
			}, console.log);
			recievedItemStatisticsBySlaveID[x.instanceID] = recievedItemStatistics;
		}
		recievedItemStatistics.add({
			key:req.body.name,
			value:req.body.count,
		});
		prometheusExportGauge.labels(x.instanceID, req.body.name).inc(Number(req.body.count) || 0);
		// save items we get
		db.items.addItem({
			name:req.body.name,
			count:req.body.count
		});

		// Attempt confirming
		res.send("success");
	} else {
		res.send("failure");
	}
});
const routes_api_remove = require("./routes/api/remove.js");
var neuralDole = null;

if(config.useNeuralNetDoleDivider)//Only initialize neural network when it's enabled, otherwise it might override gauge
	neuralDole=new routes_api_remove.neuralDole({
		items: db.items, gaugePrefix: prometheusPrefix
	});
/**
POST endpoint to remove items from DB when client orders items.

@memberof clusterioMaster
@instance
@alias api/remove
@param {itemStack} itemStack the name of and the number of items to remove (see typedef)
@param {string} [itemStack.instanceID="unknown"] the unique/instanceID which is a numerical value for an instance
@param {string} [itemStack.instanceName="unknown"] the name of an instance for identification in statistics, as provided when launching it. ex node client.js start [name]
@returns {itemStack} the number of items actually removed, may be lower than what was asked for due to shortages.
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
	if(slaves[object.instanceID]) object.instanceName = slaves[object.instanceID].instanceName;
	let item = db.items[object.name];
		// console.dir(doc);
	if((item === undefined)
	||((
		config.disableImportsOfEverythingExceptElectricity === true || config.disableImportsOfEverythingExceptElectricity === "true" )
		&& object.name != "electricity")
	){
		if(config.logItemTransfers){
			console.log('failure could not find ' + object.name);
		}
		res.send({name:object.name, count:0});
	} else if(config.disableFairItemDistribution){
		// Give out as much items as possible until there are 0 left. This might lead to one slave getting all the items and the rest nothing.
		let numberToRemove = Math.min(Math.abs(Number(object.count)),Number(item));
		db.items.removeItem({count: numberToRemove, name: object.name});
		res.send({count: numberToRemove, name: object.name});

		// track statistics and do graphing things
		prometheusImportGauge.labels(object.instanceID, object.name).inc(Number(numberToRemove) || 0);
		let sentItemStatistics = sentItemStatisticsBySlaveID[object.instanceID];
		if(sentItemStatistics === undefined){
			sentItemStatistics = new averagedTimeSeries({
				maxEntries: config.itemStats.maxEntries,
				entriesPerSecond: config.itemStats.entriesPerSecond,
				mergeMode: "add",
			}, console.log);
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
		routes_api_remove.doleDivider({
			item,
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
GET endpoint to read the masters current inventory of items.

@memberof clusterioMaster
@instance
@alias api/inventory
@returns {object[]} JSON [{name:"iron-plate", count:100},{name:"copper-plate",count:5}]
*/
// endpoint for getting an inventory of what we got
app.get("/api/inventory", function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	var inventory = [];
	for(let key in db.items){
		if(typeof db.items[key] == "number" || typeof db.items[key] == "string"){
			inventory.push({name:key, count:db.items[key]});
		}
	}
	res.send(JSON.stringify(inventory));
});
/**
GET endpoint to read the masters inventory as an object with key:value pairs

@memberof clusterioMaster
@instance
@alias api/inventoryAsObject
@returns {object} JSON {"iron-plate":100, "copper-plate":5}
*/
app.get("/api/inventoryAsObject", function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	res.send(JSON.stringify(db.items));
});

/**
 GET endpoint to read the masters inventory as an object with key:value pairs

 @memberof clusterioMaster
 @instance
 @alias api/modData
 @returns {object} JSON
 */

// wrap a request in an promise
	async function downloadPage(url) {
		return new Promise((resolve, reject) => {
			request(url, (error, response, body) => {
				resolve(body);
			});
		});
	}

app.get("/api/modmeta", async function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.setHeader('Content-Type', 'application/json');
	let modData = await downloadPage("https://mods.factorio.com/api/mods/" + req.query.modname);
	res.send(modData);
});


/**
POST endpoint for running commands on slaves.
Requires x-access-token header to be set. Find you api token in secret-api-token.txt on the master (after running it once)

@memberof clusterioMaster
@instance
@alias api/runCommand
@param {object} JSON {instanceID:19412312, broadcast:false, command:"/c game.print('hello')"}
@returns {object} Status {auth: bool, message: "Informative error", data:{}}
*/
app.post("/api/runCommand", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	// validate request.body
	let body = req.body;

	if (
		body.broadcast
		&& body.command
		&& typeof body.command == "string"
		&& body.command[0] == "/")
	{
		let instanceResponses = [];
		for (let instanceID in wsSlaves) {
			// skip loop if the property is from prototype
			if (!wsSlaves.hasOwnProperty(instanceID)) continue;
			wsSlaves[instanceID].runCommand(body.command);
		}
		res.status(200).send({auth: true, message: "success", response: "Cluster wide messaging initiated"});
	} else if (
		body.instanceID
		&& wsSlaves[body.instanceID]
		&& body.command
		&& typeof body.command == "string"
		&& body.command[0] == "/")
	{
		// execute command
		wsSlaves[body.instanceID].runCommand(body.command, data => {
			res.status(200).send({auth: true, message: "success", data});
		});
	} else {
		res.status(400).send({auth: true, message: "Error: invalid request.body"});
	}
});
/**
GET endpoint. Returns factorio's base locale as a JSON object.

@memberof clusterioMaster
@instance
@alias api/getFactorioLocale
@returns {object{}} 2 deep nested object with base game factorio locale as key:value pairs
*/
app.get("/api/getFactorioLocale", function(req,res){
	endpointHitCounter.labels(req.route.path).inc();
	getFactorioLocale.asObject(config.factorioDirectory, "en", (err, factorioLocale) => {
		res.send(factorioLocale);
	});
});

/* Websockets for plugins */
var io = require("socket.io")({});
const ioMetrics = require("socket.io-prometheus");
ioMetrics(io);


/* Websockets for send and recieve combinators */
var wsSlaves = {};
class wsSlave {
	constructor(instanceID, socket){
		this.instanceID = instanceID;
		this.socket = socket;
		this.lastBeat = Date.now();

		this.socket.on("heartbeat", () => {
			prometheusWsUsageCounter.labels('heartbeat', this.instanceID).inc();
			this.lastBeat = Date.now();
		});
		this.socket.on("combinatorSignal", circuitFrameWithMeta => {
			prometheusWsUsageCounter.labels('combinatorSignal', this.instanceID).inc();
			if(circuitFrameWithMeta && typeof circuitFrameWithMeta == "object"){
				Object.keys(wsSlaves).forEach(instanceID => {
					wsSlaves[instanceID].socket.emit("processCombinatorSignal", circuitFrameWithMeta);
				});
			}
		});
		// handle command return values
		this.commandsWaitingForReturn = {};
		this.socket.on("runCommandReturnValue", resp => {
			prometheusWsUsageCounter.labels('runCommandReturnValue', this.instanceID).inc();
			if(resp.commandID && resp.body && this.commandsWaitingForReturn[resp.commandID] && this.commandsWaitingForReturn[resp.commandID].callback && typeof this.commandsWaitingForReturn[resp.commandID].callback == "function"){
				this.commandsWaitingForReturn[resp.commandID].callback(resp.body);
				delete this.commandsWaitingForReturn[resp.commandID];
			}
		});

		this.socket.on("gameChat", data => {
			prometheusWsUsageCounter.labels('gameChat', this.instanceID).inc();
			if(typeof data === "object"){
				data.timestamp = Date.now();
				if(!global.wsChatRecievers) global.wsChatRecievers = [];
				global.wsChatRecievers.forEach(socket => {
					socket.emit("gameChat", data);
				});
			}
		});

		this.socket.on("alert", alert => {
			prometheusWsUsageCounter.labels('alert', this.instanceID).inc();
			if(typeof alert === "object"){
				alert.timestamp = Date.now();
				if(!global.wsAlertRecievers) global.wsAlertRecievers = [];
				global.wsAlertRecievers.forEach(socket => {
					socket.emit("alert", alert);
				});
			}
		});
	}
	runCommand(command, callback){
		let commandID = Math.random().toString();
		this.socket.emit("runCommand", {command, commandID});
		if(commandID) this.commandsWaitingForReturn[commandID] = {callback, timestamp: Date.now()};
	}
}

io.on('connection', function (socket) {
	// cleanup dead sockets from disconnected people
	let terminatedConnections = 0;
	let currentConnections = Object.keys(wsSlaves).length;
	[wsSlaves].forEach(list => {
		Object.keys(list).forEach(connectionID => {
			let connection = list[connectionID];
			if(connection.lastBeat < (Date.now() - 30000)){
				terminatedConnections++;
				delete list[connectionID];
			}
		});
	});
	if(terminatedConnections > 0) console.log("SOCKET | There are currently "+currentConnections+" websocket connections, deleting "+terminatedConnections+" on timeout");

	// tell our friend that we are listening
	setTimeout(()=>socket.emit('hello', { hello: 'world' }), 5000);

	/* Websockets for send and recieve combinators */
	socket.on("registerSlave", function(data) {
		prometheusWsUsageCounter.labels('registerSlave', "other").inc();
		if(data && data.instanceID){
			wsSlaves[data.instanceID] = new wsSlave(data.instanceID, socket);
			console.log("SOCKET | Created new wsSlave: "+ data.instanceID);
		}
	});
	socket.on("registerChatReciever", function(data){
		prometheusWsUsageCounter.labels("registerChatReciever", "other").inc();
		if(!global.wsChatRecievers) global.wsChatRecievers = [];
		global.wsChatRecievers.push(socket);
	});
	socket.on("registerAlertReciever", function(data){
		prometheusWsUsageCounter.labels("registerAlertReciever", "other").inc();
		if(!global.wsAlertRecievers) global.wsAlertRecievers = [];
		global.wsAlertRecievers.push(socket);
	});
});

// handle plugins on the master
var masterPlugins = [];
async function pluginManagement(){
	let startPluginLoad = Date.now();
	masterPlugins = await getPlugins();
	console.log("All plugins loaded in "+(Date.now() - startPluginLoad)+"ms");
}

async function getPlugins(){
	const pluginManager = require("lib/manager/pluginManager.js")(config);
	let plugins = [];
	let pluginsToLoad = await pluginManager.getPlugins();
	for(let i = 0; i < pluginsToLoad.length; i++){
		let pluginStartedLoading = Date.now(); // just for logging
		let stats = await fs.stat(pluginsToLoad[i].pluginPath);
		if(stats.isDirectory()){
			let pluginConfig = pluginsToLoad[i];
			if(pluginConfig.masterPlugin && pluginConfig.enabled){
				let masterPlugin = require(path.resolve(pluginConfig.pluginPath, pluginConfig.masterPlugin));
				plugins.push({
					main:new masterPlugin({
						config,
						pluginConfig,
						path: pluginConfig.pluginPath,
						socketio: io,
						express: app,
						Prometheus,
					}),
					pluginConfig,
				});

				console.log("Loaded plugin "+pluginConfig.name+" in "+(Date.now() - pluginStartedLoading)+"ms");
			}
		}
	}
	for(let i in plugins){
		let plugin = plugins[i];
		if(plugin.main.onLoadFinish && typeof plugin.main.onLoadFinish == "function") await plugin.main.onLoadFinish({plugins});
	}
	return plugins;
}

// Errror class for known errors occuring during startup
class StartupError extends Error { }

/**
 * Calls listen on server capturing any errors that occurs
 * binding to the port.
 */
function listen(server, ...args) {
	return new Promise((resolve, reject) => {
		function wrapError(err) {
			reject(new StartupError(
				`Server listening failed: ${err.message}`
			));
		}

		server.once('error', wrapError);
		server.listen(...args, () => {
			server.off('error', wrapError);
			resolve();
		});
	});
}

async function startServer() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioMaster";

	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

	/** Sync */
	function randomStringAsBase64Url(size) {
	  return base64url(crypto.randomBytes(size));
	}

	if (!fs.existsSync("secret-api-token.txt")) {
		config.masterAuthSecret = randomStringAsBase64Url(256);
		fs.writeFileSync("config.json",JSON.stringify(config, null, 4));
		fs.writeFileSync("secret-api-token.txt", jwt.sign({ id: "api" }, config.masterAuthSecret, {
			expiresIn: 86400*365 // expires in 1 year
		}));
		console.log("Generated new master authentication private key!");
		process.exit(0);
	}
	// write an auth token to file
	fs.writeFileSync("secret-api-token.txt", jwt.sign({ id: "api" }, config.masterAuthSecret, {
		expiresIn: 86400*365 // expires in 1 year
	}));
	setInterval(()=>{
		fs.writeFileSync(path.resolve(config.databaseDirectory, "items.json"), JSON.stringify(db.items));
	},config.autosaveInterval || 60000);
	process.on('SIGINT', shutdown); // ctrl + c
	process.on('SIGHUP', shutdown); // terminal closed

	config.databaseDirectory = args.databaseDirectory || config.databaseDirectory || "./database";
	await fs.ensureDir(config.databaseDirectory);

	const masterModFolder = path.join(config.databaseDirectory, "masterMods");
	await fs.ensureDir(masterModFolder);

	// mod downloads
	app.use(express.static(masterModFolder));

	// Make sure we're actually going to listen on a port
	let httpPort = args.masterPort || config.masterPort;
	let httpsPort = args.sslPort || config.sslPort;
	if (!httpPort && !httpsPort) {
		console.error("Error: at least one of httpPort and sslPort must be configured");
		process.exit(1);
	}

	// Create a self signed certificate if the certificate files doesn't exist
	if (httpsPort && !await fs.exists(config.sslCert) && !await fs.exists(config.sslPrivKey)) {
		await generateSSLcert({
			sslCertPath: config.sslCert,
			sslPrivKeyPath: config.sslPrivKey,
			doLogging: true,
		});
	}

	// Load plugins
	await pluginManagement();

	// Only start listening for connections after all plugins have loaded
	if (httpPort) {
		let httpServer = require("http").Server(app);
		await listen(httpServer, httpPort);
		io.attach(httpServer);
		console.log("Listening for HTTP on port %s...", httpServer.address().port);
	}

	if (httpsPort) {
		let certificate, privateKey;
		try {
			certificate = await fs.readFile(config.sslCert);
			privateKey = await fs.readFile(config.sslPrivKey);

		} catch (err) {
			throw new StartupError(
				`Error loading ssl certificate: ${err.message}`
			);
		}

		let httpsServer = require("https").createServer({
			key: privateKey,
			cert: certificate
		}, app)
		await listen(httpsServer, httpsPort);

		// XXX I'm uncertain whether or not socket.io actually supports
		// attaching to multiple servers at the same time.
		io.attach(httpsServer);
		console.log("Listening for HTTPS on port %s...", httpsServer.address().port);
	}
}

module.exports = app;

if (module === require.main) {
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startServer().catch(err => {
		if (!(err instanceof StartupError)) {
			console.error(`
+---------------------------------------------------------------+
| Unexpected error occured while starting master, please report |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+`
			);
		} else {
			console.error(`
+----------------------------------+
| Unable to to start master server |
+----------------------------------+`
			);
		}

		console.error(err);
		return shutdown();
	});
}
