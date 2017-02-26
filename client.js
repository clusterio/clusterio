var fs = require('fs-extra');
var https = require('follow-redirects').https;
var needle = require("needle");
var child_process = require('child_process');
var path = require('path');
var syncRequest = require('sync-request');
var request = require("request")
var ncp = require('ncp').ncp;
var Rcon = require('simple-rcon');
var hashFiles = require('hash-files');

// require config.json
var config = require('./config');

// Functions
function deleteFolderRecursive(path) {
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

// function to handle sending commands into the game
function messageInterface(command, callback) {
	// try to save us if you send a buffer instead of string
	if(typeof command == "object") {
		command = command.toString('utf8');
	}
	
	if(typeof command == "string" && client && client.exec && typeof client.exec == "function") {
		try {
			client.exec(command, callback);
		} catch (err) {
			console.log(err);
			callback(err);
		}
	}
}

// load plugins and execute onLoad event
let pluginDirectories = getDirectories("./sharedPlugins/");
let plugins = [];
for(i=0; i<pluginDirectories.length; i++) {
	let I = i
	let log = function(t) {
		console.log("Clusterio | "+ pluginDirectories[I] + " | " + t)
	}
	// plugins.push(require("./sharedPlugins/"+pluginDirectories[i]));
	
	let pluginConfig = require("./sharedPlugins/" + pluginDirectories[i] + "/config.js")
	plugins.push(child_process.spawn(pluginConfig.binary, [], {
		cwd: "./sharedPlugins/"+pluginDirectories[i],
		stdio: ['pipe', 'pipe', 'pipe'],
	}));
	//plugins.push();
	console.log("Clusterio | Loaded plugin " + pluginDirectories[i]);
	plugins[i].stdout.on("data", (data) => {
		log("Stdout: " + data);
		messageInterface(data.toString('utf8'));
	});
	plugins[i].stderr.on("data", (data) => {
		log("STDERR: " + data);
	})
	plugins[i].on('close', (code) => {
		console.log(`child process exited with code ${code}`);
	});
}

function triggerPluginEvent(event, plugins, data) {
	// string, array, object
	// data = {messageInterface}
	if(!data || typeof data != "object") {
		data = {};
		console.log("WARN: client.js triggerPluginEvent argument 3 has to be object, defaulting to " + JSON.stringify(data));
	}
	if(typeof event == "string" && typeof plugins == "object") {
		for(i=0;i<plugins.length;i++){
			if(plugins[i][event] && typeof plugins[i][event] == "function"){
				function log(t) {
					console.log("clusterio | "+ pluginDirectories[i] + " | " + t);
				}
				console.log("clusterio | Triggering event " + event + " on " + plugins[i]);
				plugins[i][event](data.messageInterface, log, data);
			}
		}
	}
}

if (!fs.existsSync("./instances/")) {
	fs.mkdirSync("instances");
}
if (!fs.existsSync("./sharedMods/")) {
	fs.mkdirSync("sharedMods");
}
const instance = process.argv[3];
const instancedirectory = './instances/' + instance;
const command = process.argv[2];
// handle commandline parameters
if (!command || command == "help" || command == "--help") {
	console.error("Usage: ")
	console.error("node client.js start [instance name]")
	console.error("node client.js list")
	console.error("node client.js delete [instance]")
	console.error("To download the latest version of the Clusterio lua mod, do")
	console.error("node client.js download")
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
} else if (command == "download") {
	console.log("Downloading mods...");
	// get JSON data about releases
	let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"Fuck you for requiring user agents!"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	if(url) {
		console.log(url);
		var file = fs.createWriteStream("sharedMods/"+name);
		var request = https.get(url, function(response) {
			response.pipe(file);
			console.log("Downloaded "+name)
		});
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
	// fs.symlinkSync('../../../sharedMods', instancedirectory + "/mods", 'junction') // This is broken because it can only take a file as first argument, not a folder
	fs.writeFileSync(instancedirectory + "/config.ini", "[path]\r\n\
read-data=__PATH__executable__/../../data\r\n\
write-data=__PATH__executable__/../../../instances/" + instance + "\r\n\
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
		"visibility": config.visibility,
		"username": config.username,
		"token": config.usertoken,
		"game_password": config.game_password,
		"verify_user_identity": config.verify_user_identity,
		"admins": [config.username],
		"allow_commands": config.allow_commands,
		"autosave_interval": 10,
		"autosave_slots": 5,
		"afk_autokick_interval": 0,
		"auto_pause": config.auto_pause,
		
	}
	fs.writeFileSync(instancedirectory + "/server-settings.json", JSON.stringify(serversettings, null, 4));

	var createSave = child_process.spawnSync(
		'./' + config.factorioDirectory + '/bin/x64/factorio', [
			'-c', instancedirectory + '/config.ini',
			'--create', instancedirectory + '/save.zip',
		]
	)
	console.log("Instance created!")
} else if (command == "start" && typeof instance == "string" && instance != "/" && fs.existsSync(instancedirectory)) {
	// Exit if no instance specified (it should be, just a safeguard)
	if(instancedirectory != "./instances/undefined"){
		var instanceconfig = require(instancedirectory + '/config');
	} else {
		process.exit(1)
	}
	
	// move mods from ./sharedMods to the instances mod directory
	console.log("Clusterio | Moving shared mods...")
	//ncp("./sharedMods/", instancedirectory + "/mods", function (err) {
	
	
	fs.copySync('sharedMods', instancedirectory + "/mods")


	process.on('SIGINT', function () {
		console.log("Caught interrupt signal");
		//serverprocess.stdin.write('/quit')
	});

	// Spawn factorio server
	//var serverprocess = child_process.exec(commandline)
	var serverprocess = child_process.spawn(
		'./' + config.factorioDirectory + '/bin/x64/factorio', [
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

	// connect to the server with rcon
	// IP, port, password
	var client = new Rcon({
		host: 'localhost',
		port: instanceconfig.clientPort,
		password: instanceconfig.clientPassword,
		timeout: 0
	});

	// clean old log file to avoid crash
	// file exists, delete so we don't get in trouble
	try {
		fs.unlinkSync(instancedirectory+'/factorio-current.log')
	} catch (err){
		if(err){
			console.log(err);
		} else {
			console.log("Clusterio | Deleting old logs...")
		}
	}
	
	// check the logfile to see if the RCON interface is running as there is no way to continue without it
	// we read the log every 2 seconds and stop looping when we start connecting to factorio
	function checkRcon() {
		fs.readFile(instancedirectory+"/factorio-current.log", function (err, data) {
			// if (err) console.log(err);
			if(data && data.indexOf('Starting RCON interface') > 0){
				client.connect();
			} else {
				setTimeout(function(){
					checkRcon();
				},2000);
			}
		});
	}
	checkRcon();
	
	client.on('authenticated', function () {
		console.log('Clusterio | Authenticated!');
		// tell all plugins we have RCON and they can start using it
		triggerPluginEvent("onRcon", plugins, client.exec);
		instanceManagement(); // start using rcons
	}).on('connected', function () {
		console.log('Clusterio | Connected!');
		// getID();
	}).on('disconnected', function () {
		console.log('Clusterio | Disconnected!');
		// now reconnect
		client.connect();
	});

	// set some globals
	confirmedOrders = [];
	lastSignalCheck = Date.now();
}

function instanceManagement() {
	// world IDs ------------------------------------------------------------------
	hashMods(instance, function(modHashes){
		setInterval(getID, 10000);
		getID()
		function getID() {
			var payload = {
				time: Date.now(),
				rconPort: instanceconfig.clientPort,
				rconPassword: instanceconfig.clientPassword,
				serverPort: instanceconfig.factorioPort,
				unique: instanceconfig.clientPassword.hashCode(),
				publicIP: config.publicIP, // IP of the server should be global for all instances, so we pull that straight from the config
				mods:modHashes
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
	})
	
	
	// Mod uploading and management -----------------------------------------------
	// get mod names and hashes
	// string: instance, function: callback
	
	setTimeout(function(){hashMods(instance, uploadMods)}, 5000);
	function uploadMods(modHashes) {
		// [{modName:string,hash:string}, ... ]
		for(i=0;i<modHashes.length;i++){
			let payload = {
				modName: modHashes[i].modName,
				hash: modHashes[i].hash,
			}
			needle.post(config.masterIP + ":" + config.masterPort + '/checkMod', payload, function (err, response, body) {
				if(err) throw err // Unable to contact master server! Please check your config.json.
				if(response && body && body == "found") {
					console.log("master has mod")
				} else if (response && body && typeof body == "string") {
					let mod = response.body;
					console.log("Sending mod: " + mod)
					// Send mods master says it wants
					// response.body is a string which is a modName.zip
					
					/*needle.post(config.masterIP + ":" + config.masterPort + '/uploadMod', payload, function (err, response, body) {
						// we did it, keep going
					}
					*/
					
					var req = request.post("http://"+config.masterIP + ":" + config.masterPort + '/uploadMod', function (err, resp, body) {
						if (err) {
							console.log('Error!');
							throw err
						} else {
							console.log('URL: ' + body);
						}
					});
					var form = req.form();
					form.append('file', fs.createReadStream("./instances/"+instance+"/mods/"+mod));
				}
			});
		}
	}
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
				inventoryFrame["signal-unixtime"] = Math.floor(Date.now()/1000);
				console.log("RCONing inventory! " + JSON.stringify(inventoryFrame));
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
} // END OF INSTANCE START ---------------------------------------------------------------------

// get all directories in folder
function getDirectories(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}

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
// string, function
// returns [{modName:string,hash:string}, ... ]
function hashMods(instanceName, callback) {
	if(!callback) {
		throw "ERROR in function hashMods NO CALLBACK"
	}
	function callback2(hash, modName){
		hashedMods[hashedMods.length] = {
			modName: modName,
			hash: hash,
		}
		// check if this callback has ran once for each mod
		if(hashedMods.length == /*mods.length*/ + instanceMods.length) {
			callback(hashedMods);
		}
		//console.log(modname)
	}
	let hashedMods = [];
	var i = 0;
	/*let mods = fs.readdirSync("./sharedMods/")*/
	let instanceMods = fs.readdirSync("./instances/"+instanceName+"/mods/")
	
	for(o=0;o<instanceMods.length;o++) {
		if(path.extname(instanceMods[o]) != ".zip") {
			instanceMods.splice(instanceMods.indexOf(instanceMods[o]), 1); // remove element from array
		}
	}
	for(i=0; i<instanceMods.length; i++){
		let path = "./instances/"+instanceName+"/mods/"+instanceMods[i];
		let name = instanceMods[i];
		let options = {
			files:path,
		}
		// options {files:[array of paths]}
		hashFiles(options, function(error, hash) {
			// hash will be a string if no error occurred
			if(!error){
				callback2(hash, name);
			} else {
				throw error;
			}
		});
	}
}
