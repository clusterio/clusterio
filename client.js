var fs = require('fs');
var needle = require("needle");
var child_process = require('child_process');
var path = require('path')

// require config.json
var config = require('./config');
// Functions
var deleteFolderRecursive = function (path) {
	if (fs.existsSync(path)) {
		fs.readdirSync(path).forEach(function (file, index) {
			var curPath = path + "/" + file;
			if (fs.lstatSync(curPath).isDirectory()) { // recurse
				deleteFolderRecursive(curPath);
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});
		fs.rmdirSync(path);
	}
};

function getDirectories(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}
if (!fs.existsSync("./instances/")) {
	fs.mkdirSync("instances");
}
var instance = process.argv[3];
var instancedirectory = './instances/' + instance;
var command = process.argv[2];
// handle commandline parameters
if (!command || command == "help" || command == "--help") {
	console.error("Usage: ")
	console.error("node client.js start [instance name]")
	console.error("node client.js list")
	console.error("node client.js delete [instance]")
	process.exit(1)
} else if (command == "list") {
	console.dir(getDirectories("./instances/"));
	process.exit(1)
} else if (command == "delete") {
	if (!process.argv[3]) {
		console.error("Usage: node client.js delete [instance]");
		process.exit(1)
	} else if (typeof process.argv[3] == "string" && fs.existsSync("./instances/" + process.argv[3]) && process.argv[3] != "/" && process.argv[3] != "") {
		deleteFolderRecursive("./instances/" + process.argv[3]);
		console.log("Deleted instance " + process.argv[3])
		process.exit(1)
	} else {
		console.error("Instance not found: " + process.argv[3]);
		process.exit(1)
	}
} else if (command == "start" && typeof instance == "string" && instance != "/" && !fs.existsSync(instancedirectory)) {
	// if instance does not exist, create it
	console.log("Creating instance...")
	fs.mkdirSync(instancedirectory);
	fs.mkdirSync(instancedirectory + "/script-output/");
	fs.writeFileSync(instancedirectory + "/script-output/output.txt", "")
	fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "")
	fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "")
	fs.mkdirSync(instancedirectory + "/mods/")
	fs.symlinkSync('../../../clusterio_0.0.3', instancedirectory + "/mods/clusterio_0.0.3", 'junction')
	fs.writeFileSync(instancedirectory + "/config.ini", "[path]\r\n\
read-data=__PATH__executable__\\..\\..\\data\r\n\
write-data=__PATH__executable__\\..\\..\\..\\instances\\" + instance + "\r\n\
	");

	var instconf = {
		"factorioPort": Math.floor(Math.random() * 65535),
		"clientPort": Math.floor(Math.random() * 65535),
		"clientPassword": Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8),
	}
	console.log(instconf)
	fs.writeFileSync(instancedirectory + "/config.json", JSON.stringify(instconf, null, 4));

	var serversettings = {
		"name": config.username + "'s clusterio " + instance,
		"description": config.description,
		"tags": ["clusterio"],
		"max_players": "20",
		"visibility": "lan",
		"username": config.username,
		"token": config.usertoken,
		"game_password": config.game_password,
		"verify_user_identity": config.verify_user_identity,
		"admins": [config.username],
		"allow_commands": config.allow_commands,
		"autosave_interval": 10,
		"autosave_slots": 5,
		"afk_autokick_interval": 0,
		"auto_pause": config.auto_pause
	}
	fs.writeFileSync(instancedirectory + "/server-settings.json", JSON.stringify(serversettings, null, 4));

	var createSave = child_process.spawnSync(
		'./' + config.factorioDirectory + '/bin/x64/factorio.exe', [
			'-c', instancedirectory + '/config.ini',
			'--create', instancedirectory + '/save.zip',
		]
	)
	console.log("Instance created!")
}

var instanceconfig = require(instancedirectory + '/config');


process.on('SIGINT', function () {
	console.log("Caught interrupt signal");
	//serverprocess.stdin.write('/quit')
});


//var serverprocess = child_process.exec(commandline)
var serverprocess = child_process.spawn(
	'./' + config.factorioDirectory + '/bin/x64/factorio.exe', [
		'-c', instancedirectory + '/config.ini',
		'--start-server', instancedirectory + '/save.zip',
		'--rcon-port', instanceconfig.clientPort,
		'--rcon-password', instanceconfig.clientPassword,
		'--server-settings', instancedirectory + '/server-settings.json',
		'--port', instanceconfig.factorioPort
	], {
		'stdio': ['pipe', 'pipe', 'pipe']
	}
)

serverprocess.on('close', (code) => {
	console.log(`child process exited with code ${code}`);
	process.exit();
});

serverprocess.stdout.on('data', (chunk) => {
	console.log('OUT: ' + chunk);
})

serverprocess.stderr.on('data', (chunk) => {
	console.log('ERR: ' + chunk);
})

// connect us to the server with rcon
// IP, port, password
var Rcon = require('simple-rcon');
var client = new Rcon({
	host: 'localhost',
	port: instanceconfig.clientPort,
	password: instanceconfig.clientPassword,
	timeout: 0
});

// wait a few seconds to let the server finish starting before connecting rcon
//TODO: catch '2.033 Info RemoteCommandProcessor.cpp:97: Starting RCON interface at port 35002' from stdout maybe?
setTimeout(() => {
	client.connect();
}, 5000);

client.on('authenticated', function () {
	console.log('Authenticated!');
}).on('connected', function () {
	console.log('Connected!');
	getID();
}).on('disconnected', function () {
	console.log('Disconnected!');
	// now reconnect
	client.connect();
});

// set some globals
confirmedOrders = [];
lastSignalCheck = Date.now();

// world IDs ------------------------------------------------------------------
function getID() {
	var payload = {
		time: Date.now(),
		rconPort: instanceconfig.clientPort,
		rconPassword: instanceconfig.clientPassword,
		serverPort: instanceconfig.factorioPort,
		unique: instanceconfig.clientPassword.hashCode()
	}
	require('getmac').getMac(function (err, mac) {
		if (err) throw err
		payload.mac = mac
		console.log(payload)
		needle.post(config.masterIP + ":" + config.masterPort + '/getID', payload, function (err, response, body) {
			if (response && response.body) {
				// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
				console.log(response.body)
			}
		});
	})
}
setInterval(getID, 10000)
	// provide items --------------------------------------------------------------
	// trigger when something happens to output.txt
fs.watch(instancedirectory + "/script-output/output.txt", function (eventType, filename) {
		// get array of lines in file
		items = fs.readFileSync(instancedirectory + "/script-output/output.txt", "utf8").split("\n");
		// if you found anything, reset the file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/output.txt", "")
		}
		for (i = 0; i < items.length; i++) {
			if (items[i]) {
				g = items[i].split(" ");
				g[0] = g[0].replace("\u0000", "");
				// console.log("exporting " + JSON.stringify(g));
				// send our entity and count to the master for him to keep track of
				needle.post(config.masterIP + ":" + config.masterPort + '/place', {
						name: g[0],
						count: g[1]
					},
					function (err, resp, body) {
						// console.log(body);
					});
			}
		}
	})
	// request items --------------------------------------------------------------
setInterval(function () {
		// get array of lines in file
		items = fs.readFileSync(instancedirectory + "/script-output/orders.txt", "utf8").split("\n");
		// if we actually got anything from the file, proceed and reset file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
			// prepare a package of all our requested items in a more tranfer friendly format
			var preparedPackage = {};
			for (i = 0; i < items.length; i++) {
				(function (i) {
					if (items[i]) {
						items[i] = items[i].split(" ");
						items[i][0] = items[i][0].replace("\u0000", "");
						items[i][0] = items[i][0].replace(",", "");
						if (preparedPackage[items[i][0]]) {
							if (typeof Number(preparedPackage[items[i][0]].count) == "number" && typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(preparedPackage[items[i][0]].count) + Number(items[i][1])
								};
							} else if (typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(items[i][1])
								};
							}
						} else if (typeof Number(items[i][1]) == "number") {
							preparedPackage[items[i][0]] = {
								"name": items[i][0],
								"count": Number(items[i][1])
							};
						}
					}
				})(i);
			}
			// request our items, one item at a time
			for (i = 0; i < Object.keys(preparedPackage).length; i++) {
				console.log(preparedPackage[Object.keys(preparedPackage)[i]])
				needle.post(config.masterIP + ":" + config.masterPort + '/remove', preparedPackage[Object.keys(preparedPackage)[i]], function (err, response, body) {
					if (response && response.body && typeof response.body == "object") {
						// buffer confirmed orders
						confirmedOrders[confirmedOrders.length] = {
							[response.body.name]: response.body.count
						}
					}
				});
			}
			// if we got some confirmed orders
			// console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
			sadas = JSON.stringify(confirmedOrders)
			confirmedOrders = [];
			// send our RCON command with whatever we got
			client.exec("/silent-command remote.call('clusterio', 'importMany', '" + sadas + "')");
		}
	}, 3000)
	// COMBINATOR SIGNALS ---------------------------------------------------------
	// get inventory from Master and RCON it to our slave
setInterval(function () {
		needle.get(config.masterIP + ":" + config.masterPort + '/inventory', function (err, response, body) {
			if (response && response.body) {
				// Take the inventory we (hopefully) got and turn it into the format LUA accepts
				// console.log(response.body)
				var inventory = response.body;
				var inventoryFrame = {};
				for (i = 0; i < inventory.length; i++) {
					inventoryFrame[inventory[i].name] = Number(inventory[i].count);
				}
				// console.log("RCONing inventory! " + JSON.stringify(inventoryFrame));
				client.exec("/silent-command remote.call('clusterio', 'receiveInventory', '" + JSON.stringify(inventoryFrame) + "')");
			}
		});
	}, 1000)
	// send any signals the slave has been told to send
setInterval(function () {
	// Fetch combinator signals from the server
	needle.post(config.masterIP + ":" + config.masterPort + '/readSignal', {
		since: lastSignalCheck
	}, function (err, response, body) {
		if (response && response.body && typeof response.body == "object" && response.body[0]) {
			// Take the new combinator frames and compress them so we can use a single command
			frameset = [];
			for (i = 0; i < response.body.length; i++) {
				frameset[i] = response.body[i].frame;
			}
			// console.log(frameset);
			// Send all our compressed frames
			client.exec("/silent-command remote.call('clusterio', 'receiveMany', '" + JSON.stringify(frameset) + "')");
		}
	});
	// after fetching all the latest frames, we take a timestamp. During the next iteration, we fetch all frames submitted after this.
	lastSignalCheck = Date.now();

	// get outbound frames from file and send to master
	// get array of lines in file, each line should correspond to a JSON encoded frame
	signals = fs.readFileSync(instancedirectory + "/script-output/txbuffer.txt", "utf8").split("\n");
	// if we actually got anything from the file, proceed and reset file
	if (signals[0]) {
		fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
		// loop through all our frames
		for (i = 0; i < signals.length; i++) {
			(function (i) {
				if (signals[i]) {
					// signals[i] is a JSON array called a "frame" of signals. We timestamp it for storage on master
					// then we unpack and RCON in this.frame to the game later.
					framepart = JSON.parse(signals[i])
					doneframe = {
							time: Date.now(),
							frame: framepart, // thats our array of objects(single signals)
						}
						// console.log(doneframe)
					needle.post(config.masterIP + ":" + config.masterPort + '/setSignal', doneframe, function (err, response, body) {
						if (response && response.body) {
							// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
						}
					});
				}
			})(i);
		}
	}
}, 1000)

// simple string hasher
String.prototype.hashCode = function () {
	var hash = 0;
	if (this.length == 0) return hash;
	for (i = 0; i < this.length; i++) {
		char = this.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}