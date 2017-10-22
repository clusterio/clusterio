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
	} else {
		if(this[object.name] && Number(this[object.name]) != NaN){
			this[object.name] = Number(this[object.name]) + Number(object.count);
		} else {
			this[object.name] = object.count;
		}
	}
}
db.items.removeItem = function(object) {
	if(object.name == "addItem" || object.name == "removeItem") {
		console.error("Fuck you, that would screw everything up if you named your item that.");
	} else {
		if(this[object.name] && Number(this[object.name]) != NaN){
			this[object.name] = Number(this[object.name]) - Number(object.count);
		} else {
			this[object.name] = 0;
		}
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
	// {slaveID, pass, meta:{x,y,z}}
	
	if(req.body && req.body.slaveID && req.body.password && req.body.meta){
		// check for editing permissions
		if(slaves[req.body.slaveID] && slaves[req.body.slaveID].rconPassword == req.body.password){
			if(!slaves[req.body.slaveID].meta){
				slaves[req.body.slaveID].meta = {};
				slaves[req.body.slaveID].meta = deepmerge(slaves[req.body.slaveID].meta, req.body.meta, {clone:true})
			}
			console.log("Updating slave: " + slaves[req.body.slaveID].mac + " : " + slaves[req.body.slaveID].serverPort+" at " + slaves[req.body.slaveID].publicIP);
		} else {
			res.send("ERROR: Invalid slaveID or password")
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
// endpoint to send items to
app.post("/api/place", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	let x = req.body;
	if(!x.instanceName) {
		x.instanceName = "unknown";
	}
	if(!x.instanceID) {
		x.instanceID = "unknown";
	}
	if(!x.unique) {
		x.unique = "unknown";
	}
	if(	x.unique
		&& x.instanceName
		&& !isNaN(Number(x.count))// This is in no way a proper authentication or anything, its just to make sure everybody are registered as slaves before modifying the cluster (or not, to maintain backwards compat)
		/*&& stringUtils.hashCode(slaves[x.unique].rconPassword) == x.unique*/){
		
		console.log("added: " + req.body.name + " " + req.body.count+" from "+x.instanceName+" ("+x.unique+")");
		// gather statistics
		let recievedItemStatistics = recievedItemStatisticsBySlaveID[x.instanceID];
		if(recievedItemStatistics === undefined){
			recievedItemStatistics = new averagedTimeSeries({
				maxEntries: config.itemStats.maxEntries,
				entriesPerSecond: config.itemStats.entriesPerSecond,
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
// endpoint to remove items from DB when client orders items
_doleDivisionFactor = {}; //If the server regularly can't fulfill requests, this number grows until it can. Then it slowly shrinks back down.
app.post("/api/remove", function(req, res) {
	const doleDivisionRetardation = 10; //lower rates will equal more dramatic swings
	const maxDoleDivision = 250; //a higher cap will divide the store more ways, but will take longer to recover as supplies increase
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// save items we get
	var object = req.body;
	if(!object.instanceName) {
		object.instanceName = "unknown"
	}
	if(!object.instanceID) {
		object.instanceID = "unknown"
	}
	let item = db.items[object.name]
		// console.dir(doc);
	if (!item) {
		console.log('failure could not find ' + object.name);
	} else {
		const originalCount = object.count || 0;
		object.count /= ((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation;
		object.count = Math.round(object.count);
		
		console.info(`Serving ${object.count}/${originalCount} ${object.name} from ${item} ${object.name} with dole division factor ${(_doleDivisionFactor[object.name]||0)} (real=${((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation}), item is ${Number(item) > Number(object.count)?'stocked':'short'}.`);
		
		// Update existing items if item name already exists
		if(Number(item) > Number(object.count)) {
			//If successful, increase dole
			_doleDivisionFactor[object.name] = Math.max((_doleDivisionFactor[object.name]||0)||1, 1) - 1;
			//console.log("removed: " + object.name + " " + object.count + " . " + item + " and sent to " + object.instanceID + " | " + object.instanceName);
			db.items.removeItem(object);
			// res.send("successier");
			let sentItemStatistics = sentItemStatisticsBySlaveID[x.instanceID];
			if(sentItemStatistics === undefined){
				sentItemStatistics = new averagedTimeSeries({
					maxEntries: config.itemStats.maxEntries,
					entriesPerSecond: config.itemStats.entriesPerSecond,
				}, console.log);
			}
			sentItemStatistics.add({
				key:object.name,
				value:object.count,
			});
			res.send(object);
		} else {
			// if we didn't have enough, attempt giving out a smaller amount next time
			_doleDivisionFactor[object.name] = Math.min(maxDoleDivision, Math.max((_doleDivisionFactor[object.name]||0)||1, 1) * 2);
			res.send({name:object.name, count:0});
			//console.log('failure out of ' + object.name + " | " + object.count + " from " + object.instanceID + " ("+object.instanceName+")");
		}
	}
});

// circuit stuff
app.post("/api/setSignal", function(req,res) {
	if(typeof req.body == "object" && req.body.time){
		db.signals.insert(req.body);
		// console.log("signal set");
	}
});

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
app.get("/api/inventoryAsObject", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	res.send(JSON.stringify(db.items));
});

// post flowstats here for production graphs
// {timestamp: Date, slaveID: string, data: {"item":number}}
app.post("/api/logStats", function(req,res) {
	if(typeof req.body == "object" && req.body.slaveID && req.body.timestamp && req.body.data) {
		if(Number(req.body.timestamp) != NaN){
			req.body.timestamp = Number(req.body.timestamp);
			db.flows.insert({
				slaveID: req.body.slaveID,
				timestamp: req.body.timestamp,
				data: req.body.data,
			});
			console.log("inserted: " + req.body.slaveID + " | " + req.body.timestamp);
		} else {
			console.log("error invalid timestamp " + req.body.timestamp);
			res.send(failure);
		}
	} else {
		res.send("failure");
	}
});
// {slaveID: string, fromTime: Date, toTime, Date}
app.post("/api/getStats", function(req,res) {
	if(typeof req.body == "string"){
		req.body = JSON.stringify(req.body);
	}
	console.log(req.body);
	if(typeof req.body == "object" && req.body.slaveID && req.body.statistic === undefined) {
		// if not specified, get stats for last 24 hours
		if(!req.body.fromTime) {
			req.body.fromTime = Date.now() - 86400000 // 24 hours in MS
		}
		if(!req.body.toTime) {
			req.body.toTime = Date.now();
		}
		console.log("Looking... " + JSON.stringify(req.body));
		db.flows.find({
			slaveID: req.body.slaveID,
		}, function(err, docs) {
			let entries = docs.filter(function (el) {
				return el.timestamp <= req.body.toTime && el.timestamp >= req.body.fromTime;
			});
			// console.log(entries);
			res.send(entries);
		});
	} else if(typeof req.body == "object" && req.body.slaveID && typeof req.body.slaveID == "string" && req.body.itemName){
		if(req.body.statistic == "place"){
			console.log("sending place data...");
			// Gather data
			console.log(recievedItemStatisticsBySlaveID)
			let itemStats = recievedItemStatisticsBySlaveID[req.body.slaveID];
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
			
		}
	}
});

// Modified version of getStats which feeds the web interface production graphs
// at /nodes. It is like getStats but it does not report items which were not
// produced at the moment of recording. (This is to save space, the 0-items were
// making up about 92% of the response body weight.)
app.post("/api/getTimelineStats", function(req,res) {
	console.log(req.body);
	if(typeof req.body == "object" && req.body.slaveID) {
		// if not specified, get stats for last 24 hours
		if(!req.body.fromTime) {
			req.body.fromTime = Date.now() - 86400000 // 24 hours in MS
		}
		if(!req.body.toTime) {
			req.body.toTime = Date.now();
		}
		console.log("Looking... " + JSON.stringify(req.body));
		db.flows.find({
			slaveID: req.body.slaveID,
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
						delete el.data[key];
					}
				}
			});
			
			res.send(docs);
		});
	}
});

app.get("/api/getFactorioLocale", function(req,res){
	getFactorioLocale.asObject(config.factorioDirectory, "en", (err, factorioLocale) => res.send(factorioLocale));
});

// endpoint for getting the chartjs library
app.get("/chart.js", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	res.end(fs.readFileSync("node_modules/chartjs/chart.js"));
});

var server = app.listen(config.masterPort || 8080, function () {
	console.log("Listening on port %s...", server.address().port);
});
