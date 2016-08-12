// Library for create folder if it does not exist
var mkdirp = require("mkdirp");
var nedb = require("nedb")
var fs = require("fs");

var express = require("express");
// Required for express post requests
var bodyParser = require("body-parser");
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Set folder to serve static content from (the website)
app.use(express.static('static'));

// set up database
var Datastore = require('nedb');
db = {};
db.items = new Datastore({ filename: 'database/items.db', autoload: true });

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
db.items.removeitem = function(object) {
	db.items.findOne({name:object.name}, function (err, doc) {
		// console.dir(doc);
		if (doc) {
			// Update existing items if item name already exists
			if(Number(doc.count) > Number(object.count)) {
				object.count = Number(doc.count) - Number(object.count);
				db.items.update(doc, object, {multi:true}, function (err, numReplaced) {});
				return true;
			} else {
				return false;
			}
		} else {
			return false;
		}
	})
}

// endpoint to send items to
app.post("/place", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	console.log(req.body);
	// save items we get
	db.items.additem(req.body)
	// Attempt confirming
	res.send("success!");
});

// endpoint to remove items from DB when client orders items
app.post("/place", function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	console.log(req.body);
	// save items we get
	if(db.items.removeitem(req.body);) {
		// if true, the action was successfull
		res.send("success");
	} else {
		res.send('failure');
	}
});

var server = app.listen(8080, function () {
	console.log("Listening on port %s...", server.address().port);
});
