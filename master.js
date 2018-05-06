/**
Clusterio master server. Facilitates communication between slaves through
a webserver, storing data related to slaves like production graphs and
combinator signals.

@module clusterioMaster
@author Danielv123

@example
node master.js
*/

// Set the process title, shows up as the title of the CMD window on windows
// and as the process name in ps/top on linux.
process.title = "clusterioMaster";

// add better stack traces on promise rejection
process.on('unhandledRejection', r => console.log(r));

// configgy stuff
debug = false;

// constants
const masterModFolder = "./database/masterMods/";
var config = require('./config');

// homebrew modules
const getFactorioLocale = require("./lib/getFactorioLocale");
const stringUtils = require("./lib/stringUtils");

// homemade express middleware for token auth
const authenticate = require("./lib/authenticate");

// Library for create folder recursively if it does not exist
const mkdirp = require("mkdirp");
mkdirp.sync("./database");
mkdirp.sync(masterModFolder);
const averagedTimeSeries = require("averaged-timeseries");
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs");
const nedb = require("nedb");

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
// write an auth token to file
fs.writeFileSync("secret-api-token.txt", jwt.sign({ id: "api" }, config.masterAuthSecret, {
	expiresIn: 86400*365 // expires in 1 year
}));

const express = require("express");
const compression = require('compression');
const ejs = require("ejs");
// Required for express post requests
const bodyParser = require("body-parser");
const fileUpload = require('express-fileupload');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(compression());

// dynamic HTML generations with EJS
app.set('views', path.join(__dirname, 'static'));
app.set('view engine', 'html');
app.engine('html', ejs.renderFile);

var routes = require("./routes.js");
routes(app);


// Set folder to serve static content from (the website)
app.use(express.static('static'));
// mod downloads
app.use(express.static(masterModFolder));

// set up logging software
const prometheusPrefix = "clusterio_";
const Prometheus = require('prom-client');
Prometheus.collectDefaultMetrics({ timeout: 10000 }); // collects RAM usage etc every 10 s
const httpRequestDurationMilliseconds = new Prometheus.Histogram({
  name: prometheusPrefix+'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['route'],
  // buckets for response time from 0.1ms to 500ms
  buckets: [0.10, 5, 15, 50, 100, 200, 300, 400, 500]
});
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
const prometheusProductionGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'production_gauge',
	help: 'Items produced by instance',
	labelNames: ["instanceID", "itemName"],
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
const prometheusPlayerCountGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'player_count_gauge',
	help: 'Amount of players connected to this cluster',
	labelNames: ["instanceID", "instanceName"],
});
const prometheusMasterInventoryGauge = new Prometheus.Gauge({
	name: prometheusPrefix+'master_inventory_gauge',
	help: 'Amount of items stored on master',
	labelNames: ["itemName"],
});
setInterval(()=>{
	let numberOfActiveSlaves = 0;
	for(let instance in slaves){
		if(Date.now() - Number(slaves[instance].time) < 1000 * 30) numberOfActiveSlaves++;
	}
	prometheusConnectedInstancesCounter.set(numberOfActiveSlaves);
},10000);
/**
GET Prometheus metrics endpoint. Returns performance and usage metrics in a prometheus readable format.
@memberof clusterioMaster
@instance
@alias /metrics
*/
app.get('/metrics', (req, res) => {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	res.set('Content-Type', Prometheus.register.contentType);
	
	/// gather some static metrics
	// playercount
	for(let instanceID in slaves){try{
		prometheusPlayerCountGauge.labels(instanceID, slaves[instanceID].instanceName).set(Number(slaves[instanceID].playerCount) || 0);
	}catch(e){}}
	// inventory
	for(let key in db.items){
		if(typeof db.items[key] == "number" || typeof db.items[key] == "string"){
			prometheusMasterInventoryGauge.labels(key).set(Number(db.items[key]) || 0);
		}
	}
	
	res.end(Prometheus.register.metrics());
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});

// set up database
var Datastore = require('nedb');
db = {};
var LinvoDB = require("linvodb3");
LinvoDB.dbPath = "./database/linvodb/";
// database for items in system
// db.items = new Datastore({ filename: 'database/items.db', autoload: true });

// in memory database for combinator signals
db.signals = new Datastore({ filename: 'database/signals.db', autoload: true, inMemoryOnly: true});
db.signals.ensureIndex({ fieldName: 'time', expireAfterSeconds: 3600 }, function (err) {});

// production chart database
db.flows = new LinvoDB("flows", {}, {});


(function(){
	try{
		let x = fs.statSync("database/slaves.json");
		console.log("loading slaves from database/slaves.json");
		slaves = JSON.parse(fs.readFileSync("database/slaves.json"));
	} catch (e){
		slaves = {};
	}
	try{
		x = fs.statSync("database/items.json");
		console.log("loading items from database/items.json");
		db.items = JSON.parse(fs.readFileSync("database/items.json"));
	} catch (e){
		db.items = {};
	}
})()

db.items.addItem = function(object) {
	if(object.name == "addItem" || object.name == "removeItem") {
		console.error("Fuck you, that would screw everything up if you named your item that.");
		return false;
	} else {
		if(this[object.name] && Number(this[object.name]) != NaN){
			this[object.name] = Number(this[object.name]) + Number(object.count);
		} else {
			this[object.name] = object.count;
		}
		return true;
	}
}
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
}

// store slaves and inventory in a .json full of JSON data
process.on('SIGINT', function () {
	console.log('Ctrl-C...');
	// set insane limit to slave length, if its longer than this we are probably being ddosed or something
	if(slaves && Object.keys(slaves).length < 2000000){
		console.log("saving to slaves.json");
		fs.writeFileSync("database/slaves.json", JSON.stringify(slaves));
	} else if(slaves) {
		console.log("Slave database too large, not saving ("+Object.keys(slaves).length+")");
	}
	if(db.items && Object.keys(db.items).length < 50000){
		console.log("saving to items.json");
		fs.writeFileSync("database/items.json", JSON.stringify(db.items));
	} else if(slaves) {
		console.log("Item database too large, not saving ("+Object.keys(slaves).length+")");
	}
	process.exit(2);
});

/**
POST World ID management. Slaves post here to tell the server they exist
@memberof clusterioMaster
@instance
@alias /api/getID
*/
app.post("/api/getID", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	// request.body should be an object
	// {rconPort, rconPassword, serverPort, mac, time}
	// time us a unix timestamp we can use to check for how long the server has been unresponsive
	// we should save that somewhere and give appropriate response
	if(req.body){
		if(debug){
			console.log(req.body)
		}
		if(!slaves[req.body.unique]){
			slaves[req.body.unique] = {};
		}
		for(k in req.body){
			if(k != "meta" && req.body.hasOwnProperty(k)){
				slaves[req.body.unique][k] = req.body[k];
			}
		}
		console.log("Slave registered: " + slaves[req.body.unique].mac + " : " + slaves[req.body.unique].serverPort+" at " + slaves[req.body.unique].publicIP + " with name " + slaves[req.body.unique].instanceName);
	}
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});
/**
POST Allows you to add metadata related to slaves for other tools, like owner data, descriptions or statistics.
@memberof clusterioMaster
@instance
@alias /api/editSlaveMeta
*/
app.post("/api/editSlaveMeta", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	// request.body should be an object
	// {instanceID, pass, meta:{x,y,z}}
	
	if(req.body && req.body.instanceID && req.body.password && req.body.meta){
		// check for editing permissions
		if(slaves[req.body.instanceID] && slaves[req.body.instanceID].rconPassword == req.body.password){
			if(!slaves[req.body.instanceID].meta){
				slaves[req.body.instanceID].meta = {};
			}
			slaves[req.body.instanceID].meta = deepmerge(slaves[req.body.instanceID].meta, req.body.meta, {clone:true});
			let metaPortion = JSON.stringify(req.body.meta);
			if(metaPortion.length > 50) metaPortion = metaPortion.substring(0,20) + "...";
			console.log("Updating slave "+slaves[req.body.instanceID].instanceName+": " + slaves[req.body.instanceID].mac + " : " + slaves[req.body.instanceID].serverPort+" at " + slaves[req.body.instanceID].publicIP, metaPortion);
		} else {
			res.send("ERROR: Invalid instanceID or password")
		}
	}
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});

/**
POST Get metadata from a single slave. For whenever you find the data returned by /api/slaves overkill.
@memberof clusterioMaster
@instance
@alias /api/getSlaveMeta
*/
app.post("/api/getSlaveMeta", function (req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	console.log("body", req.body);
    if(req.body && req.body.instanceID && req.body.password){
    	console.log("returning meta for ", req.body.instanceID);
    	res.send(JSON.stringify(slaves[req.body.instanceID].meta))
	} else {
    	res.status(400);
    	res.send('{"INVALID REQUEST":1}');
	}
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});
// mod management
// should handle uploading and checking if mods are uploaded
/**
POST Check if a mod has been uploaded to the master before. Only checks against filename, not hash.
@memberof clusterioMaster
@instance
@alias /api/checkMod
*/
app.post("/api/checkMod", function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	let files = fs.readdirSync(masterModFolder);
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
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});
/**
POST endpoint for uploading mods to the master server. Required for automatic mod downloads with factorioClusterioClient (electron app, see seperate repo)
@memberof clusterioMaster
@instance
@alias /api/uploadMod
*/
app.post("/api/uploadMod", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	if (!req.files) {
        res.send('No files were uploaded.');
        return;
    } else {
		console.log(req.files.file);
		req.files.file.mv('./database/masterMods/'+req.files.file.name, function(err) {
			if (err) {
				res.status(500).send(err);
			} else {
				res.send('File uploaded!');
				console.log("Uploaded mod: " + req.files.file.name);
			}
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
		});
	}
});
/**
GET endpoint for getting information about all our slaves
@memberof clusterioMaster
@instance
@alias /api/slaves
*/
let slaveCache = {
	timestamp: Date.now(),
};
app.get("/api/slaves", function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	if(!slaveCache.cache || Date.now() - slaveCache.timestamp > 5000){
		let copyOfSlaves = JSON.parse(JSON.stringify(slaves));
		// filter out the rcon password because thats kindof not a safe thing to share
		for(key in copyOfSlaves){
			copyOfSlaves[key].rconPassword = "hidden";
		}
		slaveCache.cache = copyOfSlaves;
		slaveCache.timestamp = Date.now();
	}
	
	res.send(slaveCache.cache);
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});
var recievedItemStatisticsBySlaveID = {};
var sentItemStatisticsBySlaveID = {};
/*
var recievedItemStatistics = new averagedTimeSeries({
	maxEntries: config.itemStats.maxEntries,
	entriesPerSecond: config.itemStats.entriesPerSecond,
}, console.log);*/
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
	let reqStartTime = Date.now();
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
	if(	x.instanceID
		&& x.instanceName
		&& !isNaN(Number(x.count))// This is in no way a proper authentication or anything, its just to make sure everybody are registered as slaves before modifying the cluster (or not, to maintain backwards compat)
		/*&& stringUtils.hashCode(slaves[x.unique].rconPassword) == x.unique*/){
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
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
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
_doleDivisionFactor = {}; //If the server regularly can't fulfill requests, this number grows until it can. Then it slowly shrinks back down.
app.post("/api/remove", authenticate.middleware, function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	const doleDivisionRetardation = 10; //lower rates will equal more dramatic swings
	const maxDoleDivision = 250; //a higher cap will divide the store more ways, but will take longer to recover as supplies increase
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
	let item = db.items[object.name]
		// console.dir(doc);
	if (!item) {
		if(config.logItemTransfers){
			console.log('failure could not find ' + object.name);
		}
		res.send({name:object.name, count:0});
	} else {
		const originalCount = Number(object.count) || 0;
		object.count /= ((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation;
		object.count = Math.round(object.count);
		if(item.length > 40) console.info(`Serving ${object.count}/${originalCount} ${object.name} from ${item} ${object.name} with dole division factor ${(_doleDivisionFactor[object.name]||0)} (real=${((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation}), item is ${Number(item) > Number(object.count)?'stocked':'short'}.`);
		
		// Update existing items if item name already exists
		if(Number(item) > Number(object.count)) {
			//If successful, increase dole
			_doleDivisionFactor[object.name] = Math.max((_doleDivisionFactor[object.name]||0)||1, 1) - 1;
			if(config.logItemTransfers){
				console.log("removed: " + object.name + " " + object.count + " . " + item + " and sent to " + object.instanceID + " | " + object.instanceName);
			}
			if(db.items.removeItem({count: object.count, name: object.name})){
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
					value:object.count,
				});
				//console.log(sentItemStatistics.data)
				sentItemStatisticsBySlaveID[object.instanceID] = sentItemStatistics;
			}
			
			prometheusImportGauge.labels(object.instanceID, object.name).inc(Number(object.count) || 0);
			res.send({count: object.count, name: object.name});
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
		} else {
			// if we didn't have enough, attempt giving out a smaller amount next time
			_doleDivisionFactor[object.name] = Math.min(maxDoleDivision, Math.max((_doleDivisionFactor[object.name]||0)||1, 1) * 2);
			res.send({name:object.name, count:0});
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
			//console.log('failure out of ' + object.name + " | " + object.count + " from " + object.instanceID + " ("+object.instanceName+")");
		}
	}
});

// circuit stuff
/**
POST endpoint to send and store circuit frames on the master.
Gives no response

@memberof clusterioMaster
@instance
@alias api/setSignal
@param {object} circuitFrame
@param {number} circuitFrame.time
*/
app.post("/api/setSignal", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	if(typeof req.body == "object" && req.body.time){
		db.signals.insert(req.body);
		httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
		// console.log("signal set");
	}
});
/**
POST endpoint to read database of circuit signals sent to master

@memberof clusterioMaster
@instance
@alias api/readSignal
@returns {object} circuitFrame
*/
app.post("/api/readSignal", function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	// request.body should be an object
	// {since:UNIXTIMESTAMP,}
	// we should send an array of all signals since then
	db.signals.find({time:{$gte: req.body.since}}, function (err, docs) {
		// $gte means greater than or equal to, meaning we only get entries newer than the timestamp
		res.send(docs);
		httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
		// console.log(docs);
	});
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
	let reqStartTime = Date.now();
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
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
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
	let reqStartTime = Date.now();
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	res.send(JSON.stringify(db.items));
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});

// post flowstats here for production graphs
// {timestamp: Date, instanceID: string, data: {"item":number}}
/**
POST endpoint to log production graph statistics. Should contain a timestamp
gathered from Date.now(), a instanceID (also reffered to as "unique") and of
course the timeSeries data.

@memberof clusterioMaster
@instance
@alias api/logStats
@param {object} JSON {timestamp: Date.now(), instanceID: "string", data: {"item": number}}
@returns {string} failure
*/
app.post("/api/logStats", authenticate.middleware, function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	if(typeof req.body == "object" && req.body.instanceID && req.body.timestamp && req.body.data) {
		if(Number(req.body.timestamp) != NaN){
			req.body.timestamp = Number(req.body.timestamp);
			db.flows.insert({
				instanceID: req.body.instanceID,
				timestamp: req.body.timestamp,
				data: req.body.data,
			});
			try{
			Object.keys(req.body.data).forEach(itemName => {
				prometheusProductionGauge.labels(req.body.instanceID, itemName).inc(Number(req.body.data[itemName]) || 0);
			});
			}catch(e){console.log(e)};
			console.log("inserted: " + req.body.instanceID + " | " + req.body.timestamp);
		} else {
			console.log("error invalid timestamp " + req.body.timestamp);
			res.send("failure");
		}
	} else {
		res.send("failure");
	}
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});
// {instanceID: string, fromTime: Date, toTime, Date}
/**
POST endpoint to get timeSeries statistics stored on the master. Can give production
graphs and other IO statistics.

@memberof clusterioMaster
@instance
@alias api/getStats
@param {object} JSON
@returns {object} - with statistics
*/
app.post("/api/getStats", function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	if(typeof req.body == "string"){
		req.body = JSON.parse(req.body);
	}
	// console.log(req.body);
	if(typeof req.body == "object" && req.body.instanceID && req.body.statistic === undefined) {
		// if not specified, get stats for last 24 hours
		if(!req.body.fromTime) {
			req.body.fromTime = Date.now() - 86400000 // 24 hours in MS
		}
		if(!req.body.toTime) {
			req.body.toTime = Date.now();
		}
		console.log("Looking... " + JSON.stringify(req.body));
		db.flows.find({
			instanceID: req.body.instanceID,
		}, function(err, docs) {
			let entries = docs.filter(function (el) {
				return el.timestamp <= req.body.toTime && el.timestamp >= req.body.fromTime;
			});
			// console.log(entries);
			res.send(entries);
		});
	} else if(typeof req.body == "object" && req.body.instanceID && typeof req.body.instanceID == "string" && req.body.itemName){
		if(req.body.statistic == "place"){
			console.log(`sending place data for instanceID ${req.body.instanceID} ${req.body.itemName}`);
			// Gather data
			//console.log(recievedItemStatisticsBySlaveID)
			let itemStats = recievedItemStatisticsBySlaveID[req.body.instanceID];
			if(itemStats === undefined){
				res.send({statusForDebugging:"no data available"});
				return false;
			}
			let data = itemStats.get(config.itemStats.maxEntries, req.body.itemName);
			
			res.send({
				maxEntries:config.itemStats.maxEntries,
				entriesPerSecond: config.itemStats.entriesPerSecond,
				data: data,
			});
		} else if(req.body.statistic == "remove"){
			console.log(`sending remove data for instanceID ${req.body.instanceID} ${req.body.itemName}`);
			// Gather data
			// console.log(sentItemStatisticsBySlaveID)
			let itemStats = sentItemStatisticsBySlaveID[req.body.instanceID];
			console.log(itemStats)
			if(typeof itemStats == "object"){
				let data = itemStats.get(config.itemStats.maxEntries, req.body.itemName);
				//console.log(itemStats.get(config.itemStats.maxEntries, req.body.itemName));
				res.send({
					maxEntries:config.itemStats.maxEntries,
					entriesPerSecond: config.itemStats.entriesPerSecond,
					data: data,
				});
			} else {
				res.send({statusForDebugging:"no data available"});
			}
		}
	}
	httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
});

/**
POST endpoint. Modified version of api/getStats which feeds the web interface production graphs
at /nodes. It is like getStats but it does not report items which were not
produced at the moment of recording. (This is to save space, the 0-items were
making up about 92% of the response body weight.)

@memberof clusterioMaster
@instance
@alias api/getTimelineStats
@param {object} JSON {instanceID:1941029, fromTime: ???, toTime: ???}
@returns {object[]} timeseries where each entry is a set point in time.
*/
app.post("/api/getTimelineStats", function(req,res) {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	console.log(req.body);
	if(typeof req.body == "object" && req.body.instanceID) {
		// if not specified, get stats for last 24 hours
		if(!req.body.fromTime) {
			req.body.fromTime = Date.now() - 86400000 // 24 hours in MS
		}
		if(!req.body.toTime) {
			req.body.toTime = Date.now();
		}
		console.log("Looking... " + JSON.stringify(req.body));
		db.flows.find({
			instanceID: req.body.instanceID,
		}, function(err, docs) {
			if(err) { 
				console.error(err);
				return;
			}
			
			//Filter out all the entries outside the time range.
			docs = docs.filter(function (el) {
				return el.timestamp <= req.body.toTime && el.timestamp >= req.body.fromTime;
			});
			
			//Filter out all the elements that weren't produced.
			docs.forEach(el => {
				for(let key in el.data) {
					if(el.data[key] === '0') {
						// Set value to undefined instead of using the delete keyword.
						// This is because the delete keyword is super duper slow.
						// https://stackoverflow.com/questions/208105/how-do-i-remove-a-property-from-a-javascript-object
						
						//delete el.data[key];
						el.data[key] = undefined;
					}
				}
			});
			
			res.send(docs);
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
		});
	}
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
app.post("/api/runCommand", (req,res) => {
	endpointHitCounter.labels(req.route.path).inc();
	let reqStartTime = Date.now();
	var token = req.headers['x-access-token'];
	if(!token) return res.status(401).send({ auth: false, message: 'No token provided.' });
	
	jwt.verify(token, config.masterAuthSecret, function(err, decoded) {
		if(err) return res.status(500).send({ auth: false, message: 'Failed to authenticate token.' });
		
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
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
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
				httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
            });
        } else {
            res.status(400).send({auth: true, message: "Error: invalid request.body"});
			httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
        }
	});
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
	let reqStartTime = Date.now();
	getFactorioLocale.asObject(config.factorioDirectory, "en", (err, factorioLocale) => {
		res.send(factorioLocale);
		httpRequestDurationMilliseconds.labels(req.route.path).observe(Date.now()-reqStartTime);
	});
});
var server = require("http").Server(app);
server.listen(config.masterPort || 8080, function () {
	console.log("Listening on port %s...", server.address().port);
});
/* Websockets for remoteMap */
var io = require("socket.io")(server);
var slaveMappers = {};
class slaveMapper {
	constructor(instanceID, socket) {
		this.instanceID = instanceID;
		this.socket = socket;
		this.lastBeat = Date.now();
		
		this.socket.on("heartbeat", () => {
			prometheusWsUsageCounter.labels('heartbeat', this.instanceID).inc();
			// we aren't ready to die yet apparently
			this.lastBeat = Date.now();
		});
		this.socket.on("sendChunk", function(data){
			prometheusWsUsageCounter.labels('sendChunk', this.instanceID).inc();
			mapRequesters[data.requesterID].socket.emit("displayChunk", data);
		});
		// slaveMapper sent us an entity update, process
		this.socket.on("sendEntity", entity => {
			prometheusWsUsageCounter.labels('sendEntity', this.instanceID).inc();
			Object.keys(mapRequesters).forEach(requesterName => {
				let requester = mapRequesters[requesterName];
				
				if(requester.instanceID == this.instanceID){
					// this mapRequester is listening to this slaveMapper, so we send it updates
					requester.socket.emit("displayEntity", entity);
				}
			});
		});
	}
}
var mapRequesters = {};
class mapRequester {
	constructor(requesterID, socket, instanceID){
		this.requesterID = requesterID;
		this.socket = socket;
		this.instanceID = instanceID;
		this.lastBeat = Date.now();
		
		this.socket.on("heartbeat", () => {
			prometheusWsUsageCounter.labels('heartbeat', "other").inc();
			// we aren't ready to die yet apparently
			this.lastBeat = Date.now();
		});
		this.socket.on("requestChunk", loc => {
			prometheusWsUsageCounter.labels('requestChunk', "other").inc();
			loc.requesterID = this.requesterID;
			let instanceID = loc.instanceID || this.instanceID;
			if(slaveMappers[instanceID] && typeof loc.x == "number" && typeof loc.y == "number"){
				slaveMappers[instanceID].socket.emit("getChunk", loc);
			}
		});
		this.socket.on("requestEntity", req => {
			prometheusWsUsageCounter.labels('requestEntity', "other").inc();
			req.requesterID = this.requesterID;
			let instanceID = req.instanceID || this.instanceID;
			if(slaveMappers[instanceID] && typeof req.x == "number" && typeof req.y == "number"){
				slaveMappers[instanceID].socket.emit("getEntity", req);
			}
		});
		this.socket.on("placeEntity", req => {
			prometheusWsUsageCounter.labels('placeEntity', "other").inc();
			req.requesterID = this.requesterID;
			let instanceID = req.instanceID || this.instanceID;
			if(slaveMappers[instanceID]){
				slaveMappers[instanceID].socket.emit("placeEntity", req);
			}
		});
	}
}
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
		this.commandsWaitingForReturn[commandID] = {callback, timestamp: Date.now()};
	}
}
io.on('connection', function (socket) {
	// cleanup dead sockets from disconnected people
	let terminatedConnections = 0;
	let currentConnections = Object.keys(mapRequesters).length + Object.keys(slaveMappers).length + Object.keys(wsSlaves).length;
	[mapRequesters, slaveMappers, wsSlaves].forEach(list => {
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
	socket.emit('hello', { hello: 'world' });
	
	/* initial processing for remoteMap */
	socket.on('registerSlaveMapper', function (data) {
		prometheusWsUsageCounter.labels('registerSlaveMapper', "other").inc();
		slaveMappers[data.instanceID] = new slaveMapper(data.instanceID, socket);
		console.log("remoteMap | SOCKET registered map provider for "+data.instanceID);
	});
	socket.on('registerMapRequester', function(data){
		// data {instanceID:""}
		prometheusWsUsageCounter.labels('registerMapRequester', "other").inc();
		let requesterID = Math.random().toString();
		mapRequesters[requesterID] = new mapRequester(requesterID, socket, data.instanceID);
		socket.emit("mapRequesterReady", true);
		console.log("remoteMap | SOCKET registered map requester for "+data.instanceID);
	});
	
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

module.exports = app;
