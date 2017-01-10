// constants
const masterModFolder = "./database/masterMods/"

// Library for create folder recursively if it does not exist
const mkdirp = require("mkdirp");
mkdirp.sync("./database");
mkdirp.sync(masterModFolder);

const fs = require("fs")
var nedb = require("nedb")
// require config.json
var config = require('./config');

var express = require("express");
// Required for express post requests
var bodyParser = require("body-parser");
var fileUpload = require('express-fileupload');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// Set folder to serve static content from (the website)
app.use(express.static('static'));
// mod downloads
app.use(express.static(masterModFolder));

// set up database
var Datastore = require('nedb');
db = {};
db.items = new Datastore({ filename: 'database/items.db', autoload: true });
db.signals = new Datastore({ filename: 'database/signals.db', autoload: true, inMemoryOnly: true});
db.signals.ensureIndex({ fieldName: 'time', expireAfterSeconds: 3600 }, function (err) {});
// db.slaves = new Datastore({ filename: 'database/slaves.db', autoload: true, inMemoryOnly: false});

db.items.additem = function(object) {
	db.items.findOne({name:object.name}, function (err, doc) {
		// console.dir(doc);
		if (doc) {
			// Update existing items if item name already exists
			object.count = Number(object.count) + Number(doc.count);
			db.items.update(doc, object, {multi:true}, function (err, numReplaced) {
			});
		} else {
			// If command does not match an entry, insert new document
			db.items.insert(object);
			console.log('Item created!');
		}
	})
}
var slaves = {}
// world ID management
// slaves post here to tell the server they exist
app.post("/getID", function(req,res) {
	// request.body should be an object
	// {rconPort, rconPassword, serverPort, mac, time}
	// time us a unix timestamp we can use to check for how long the server has been unresponsive
	// we should save that somewhere and give appropriate response
	if(req.body){
		slaves[req.body.unique] = req.body;
		console.log("Slave: " + req.body.mac + " : " + req.body.serverPort+" at " + req.body.publicIP);
	}
});
// mod management
// should handle uploading and checking if mods are uploaded
app.post("/checkMod", function(req,res) {
	let files = fs.readdirSync(masterModFolder)
	let found = false;
	files.forEach(file => {
		if(file == req.body.modName) {
			found = true;
		}
	});
	if(!found) {
		// we don't have mod, plz send
		res.send(req.body.modName)
	} else {
		res.send("found")
	}
	res.end()
});
app.post("/uploadMod", function(req,res) {
	if (!req.files) {
        res.send('No files were uploaded.');
        return;
    } else {
		console.log(req.files.file)
		req.files.file.mv('./database/masterMods/'+req.files.file.name, function(err) {
		if (err) {
			res.status(500).send(err);
		} else {
			res.send('File uploaded!');
			console.log("Uploaded mod: " + req.files.file.name)
		}
	});
	}
});
// endpoint for getting information about all our slaves
app.get("/slaves", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	let copyOfSlaves = slaves
	// filter out the rcon password because thats kindof not a safe thing to share
	for(key in copyOfSlaves) {
		copyOfSlaves[key].rconPassword = "hidden";
	}
	res.send(copyOfSlaves)
});

// endpoint to send items to
app.post("/place", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	console.log("added: " + req.body.name + " " + req.body.count);
	// save items we get
	db.items.additem(req.body)
	// Attempt confirming
	res.end("success");
});

// endpoint to remove items from DB when client orders items
app.post("/remove", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// save items we get
	var object = req.body;
	db.items.findOne({name:object.name}, function (err, doc) {
		// console.dir(doc);
		if (err) {
			console.log('failure');
		} else {
			if (doc) {
				// Update existing items if item name already exists
				if(Number(doc.count) > Number(object.count)) {
					console.log("removed: " + object.name + " " + object.count + " . " + doc.count);
					objectUpdate = {
						"name": object.name,
						"count": Number(doc.count) - Number(object.count),
					};
					// db.items.update(doc, objectUpdate, {multi:true}, function (err, numReplaced) {});
					db.items.update(doc, {$inc:{count:object.count*-1}}, {multi:true}, function (err, numReplaced) {});
					// res.send("successier");
					res.send(object);
				} else {
					console.log('failure');
				}
			} else {
				console.log('failure ' + object.name);
			}
		}
	})
});

// circuit stuff
app.post("/setSignal", function(req,res) {
	if(typeof req.body == "object" && req.body.time){
		db.signals.insert(req.body);
		// console.log("signal set")
	}
});

app.post("/readSignal", function(req,res) {
	// request.body should be an object
	// {since:UNIXTIMESTAMP,}
	// we should send an array of all signals since then
	db.signals.find({time:{$gte: req.body.since}}, function (err, docs) {
		// $gte means greater than or equal to, meaning we only get entries newer than the timestamp
		res.send(docs);
		// console.log(docs)
	});
});

// endpoint for getting an inventory of what we got
app.get("/inventory", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	// Check it and send it
	db.items.find({}, function (err, docs) {
		res.send(docs);
	});
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
