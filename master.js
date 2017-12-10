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

// configgy stuff
debug = false;

// constants
const masterModFolder = "./database/masterMods/";
var config = require('./config');

// homebrew modules
const getFactorioLocale = require("./lib/getFactorioLocale");
const stringUtils = require("./lib/stringUtils");

// Library for create folder recursively if it does not exist
const mkdirp = require("mkdirp");
mkdirp.sync("./database");
mkdirp.sync(masterModFolder);
const averagedTimeSeries = require("averaged-timeseries");
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs");
var nedb = require("nedb");

var express = require("express");
var ejs = require("ejs");
// Required for express post requests
var bodyParser = require("body-parser");
var fileUpload = require('express-fileupload');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

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
	if(slaves && Object.keys(slaves).length < 50000){
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

// world ID management
// slaves post here to tell the server they exist
app.post("/api/getID", function(req,res) {
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
});

app.post("/api/editSlaveMeta", function(req,res) {
	// request.body should be an object
	// {instanceID, pass, meta:{x,y,z}}
	
	if(req.body && req.body.instanceID && req.body.password && req.body.meta){
		// check for editing permissions
		if(slaves[req.body.instanceID] && slaves[req.body.instanceID].rconPassword == req.body.password){
			if(!slaves[req.body.instanceID].meta){
				slaves[req.body.instanceID].meta = {};
			}
			slaves[req.body.instanceID].meta = deepmerge(slaves[req.body.instanceID].meta, req.body.meta, {clone:true});
			console.log("Updating slave: " + slaves[req.body.instanceID].mac + " : " + slaves[req.body.instanceID].serverPort+" at " + slaves[req.body.instanceID].publicIP);
		} else {
			res.send("ERROR: Invalid instanceID or password")
		}
	}
});
// mod management
// should handle uploading and checking if mods are uploaded
app.post("/api/checkMod", function(req,res) {
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
});
app.post("/api/uploadMod", function(req,res) {
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
	});
	}
});
// endpoint for getting information about all our slaves
app.get("/api/slaves", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	let copyOfSlaves = JSON.parse(JSON.stringify(slaves));
	// filter out the rcon password because thats kindof not a safe thing to share
	for(key in copyOfSlaves){
		copyOfSlaves[key].rconPassword = "hidden";
	}
	res.send(copyOfSlaves);
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
app.post("/api/place", function(req, res) {
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
		
		console.log("added: " + req.body.name + " " + req.body.count+" from "+x.instanceName+" ("+x.instanceID+")");
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
app.post("/api/remove", function(req, res) {
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
		console.log('failure could not find ' + object.name);
		res.send({name:object.name, count:0});
	} else {
		const originalCount = Number(object.count) || 0;
		object.count /= ((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation;
		object.count = Math.round(object.count);
		
		console.info(`Serving ${object.count}/${originalCount} ${object.name} from ${item} ${object.name} with dole division factor ${(_doleDivisionFactor[object.name]||0)} (real=${((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation}), item is ${Number(item) > Number(object.count)?'stocked':'short'}.`);
		
		// Update existing items if item name already exists
		if(Number(item) > Number(object.count)) {
			//If successful, increase dole
			_doleDivisionFactor[object.name] = Math.max((_doleDivisionFactor[object.name]||0)||1, 1) - 1;
			//console.log("removed: " + object.name + " " + object.count + " . " + item + " and sent to " + object.instanceID + " | " + object.instanceName);
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
			res.send({count: object.count, name: object.name});
		} else {
			// if we didn't have enough, attempt giving out a smaller amount next time
			_doleDivisionFactor[object.name] = Math.min(maxDoleDivision, Math.max((_doleDivisionFactor[object.name]||0)||1, 1) * 2);
			res.send({name:object.name, count:0});
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
app.post("/api/setSignal", function(req,res) {
	if(typeof req.body == "object" && req.body.time){
		db.signals.insert(req.body);
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
	// request.body should be an object
	// {since:UNIXTIMESTAMP,}
	// we should send an array of all signals since then
	db.signals.find({time:{$gte: req.body.since}}, function (err, docs) {
		// $gte means greater than or equal to, meaning we only get entries newer than the timestamp
		res.send(docs);
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
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	res.send(JSON.stringify(db.items));
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
app.post("/api/logStats", function(req,res) {
	if(typeof req.body == "object" && req.body.instanceID && req.body.timestamp && req.body.data) {
		if(Number(req.body.timestamp) != NaN){
			req.body.timestamp = Number(req.body.timestamp);
			db.flows.insert({
				instanceID: req.body.instanceID,
				timestamp: req.body.timestamp,
				data: req.body.data,
			});
			console.log("inserted: " + req.body.instanceID + " | " + req.body.timestamp);
		} else {
			console.log("error invalid timestamp " + req.body.timestamp);
			res.send("failure");
		}
	} else {
		res.send("failure");
	}
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
			console.log(sentItemStatisticsBySlaveID)
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
		});
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
	getFactorioLocale.asObject(config.factorioDirectory, "en", (err, factorioLocale) => res.send(factorioLocale));
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
		
		this.socket.on("sendChunk", function(data){
			mapRequesters[data.requesterID].socket.emit("displayChunk", data)
		});
	}
}
var mapRequesters = {};
class mapRequester {
	constructor(requesterID, socket, instanceID){
		this.requesterID = requesterID;
		this.socket = socket;
		this.instanceID = instanceID;
		
		this.socket.on("requestChunk", loc => {
			loc.requesterID = this.requesterID;
			let instanceID = loc.instanceID || this.instanceID;
			if(slaveMappers[instanceID] && typeof loc.x == "number" && typeof loc.y == "number"){
				slaveMappers[instanceID].socket.emit("getChunk", loc)
			}
		});
	}
}
io.on('connection', function (socket) {
	socket.emit('hello', { hello: 'world' });
	socket.on('registerSlaveMapper', function (data) {
		slaveMappers[data.instanceID] = new slaveMapper(data.instanceID, socket);
		console.log("SOCKET registered map provider for "+data.instanceID);
	});
	socket.on('registerMapRequester', function(data){
		// data {instanceID:""}
		let requesterID = Math.random().toString();
		mapRequesters[requesterID] = new mapRequester(requesterID, socket, data.instanceID);
		
		console.log("SOCKET registered map requester for "+data.instanceID);
	});
});

module.exports = app;
