const fs = require('fs-extra');
const https = require('follow-redirects').https;
const needle = require("needle");
const child_process = require('child_process');
const path = require('path');
const syncRequest = require('sync-request');
const request = require("request");
const ncp = require('ncp').ncp;
const Rcon = require('rcon-client').Rcon;
const hashFiles = require('hash-files');
const _ = require('underscore');
const deepmerge = require("deepmerge");
const getMac = require('getmac').getMac;
const rmdirSync = require('rmdir-sync');
const ioClient = require("socket.io-client");

// internal libraries
const objectOps = require("./lib/objectOps.js");
const fileOps = require("_app/fileOps");
const stringUtils = require("./lib/stringUtils.js");
const configManager = require("./lib/manager/configManager.js");

// argument parsing
const args = require('minimist')(process.argv.slice(2));

// require config.json
var config = require(args.config || './config');
var global = {};

if (!fs.existsSync(config.instanceDirectory)) {
	fs.mkdirSync(config.instanceDirectory);
}
if (!fs.existsSync("./sharedPlugins/")) {
	fs.mkdirSync("sharedPlugins");
}
if (!fs.existsSync("./sharedMods/")) {
	fs.mkdirSync("sharedMods");
}
const instance = process.argv[3];
const instancedirectory = config.instanceDirectory + '/' + instance;
const command = process.argv[2];

// Set the process title, shows up as the title of the CMD window on windows
// and as the process name in ps/top on linux.
process.title = "clusterioClient "+instance;

// add better stack traces on promise rejection
process.on('unhandledRejection', r => console.log(r));

// make sure we have the master access token (can't write to master without it since clusterio 2.0)
if(!config.masterAuthToken || typeof config.masterAuthToken !== "string"){
	console.error("ERROR invalid config!");
	console.error("Master server now needs an access token for write operations. As clusterio slaves depends \
	upon this, please add your token to config.json in the field named masterAuthToken. \
	You can retrieve your auth token from the master in secret-api-token.txt after running it once.");
}
const needleOptionsWithTokenAuthHeader = {
	headers: {
		'x-access-token': config.masterAuthToken
	},
};

var instanceInfo = {};
var commandBuffer=[];
// messageInterface Management
setInterval(function(){
	let command=commandBuffer.shift();
	if(command){
		messageInterfaceInternal(command[0], command[1], command[2], command[3]);
	}
},config.msBetweenCommands || 50);

// function to handle sending commands into the game
async function messageInterfaceInternal(command, callback, resolve, reject) {
	// try to save us if you send a buffer instead of string
	if(typeof command == "object") {
		command = command.toString('utf8');
	}
	
	if(false && process.platform == "linux" && typeof command == "string" && serverprocess) {
		/*
			to send to stdin, use:
			serverprocess.stdin.write("/c command;\n")
		*/
		serverprocess.stdin.write(command+"\n");
		if(typeof callback == "function"){
			callback();
		}
		resolve();
	} else if(typeof command == "string" && client && client.send && typeof client.send == "function") {
		try {
			let str = await client.send(command+"\n");
			if(typeof callback == "function") callback(str)
			resolve(str)
		} catch (err) {
			console.log("RCON failed, server might be paused or shutting down");
			// console.log(err);
			// reject(err);
			if(typeof callback == "function"){
				callback();
			}
			reject(err)
		}
	}
}
function messageInterface(command, callback) {
	return new Promise((resolve,reject) => {
		commandBuffer.push([command,callback, resolve, reject]);
	});
}


// handle commandline parameters
if (!command || command == "help" || command == "--help") {
	console.error("Usage: ");
	console.error("node client.js start [instance name]");
	console.error("node client.js list");
	console.error("node client.js delete [instance]");
	console.error("To download the latest version of the Clusterio lua mod, do");
	console.error("node client.js manage shared mods download clusterio");
	console.error("For more management options, do");
	console.error("node client.js manage");
	process.exit(1);
} else if (command == "list") {
	let instanceNames = fileOps.getDirectoriesSync(config.instanceDirectory);
	instanceNames.unshift("Name:");
	let longestInstanceName = 0;
	// determine longest instance name
	instanceNames.forEach(function(instance){
		if(instance.length > longestInstanceName) longestInstanceName = instance.length;
	});
	let displayLines = [];
	// push name coloumn to array
	instanceNames.forEach(function(instance){
		while(instance.length < longestInstanceName+1){
			instance += " ";
		}
		displayLines.push("| "+ instance + "|");
	});
	// create port colloumn
	let factorioPorts = [];
	instanceNames.forEach(function(instance){
		let factorioPort;
		
		if(instance.includes("Name:")){
			factorioPort = "Port:"
		} else {
			factorioPort = require(path.resolve(config.instanceDirectory, instance, 'config')).factorioPort;
		}
		factorioPorts.push(factorioPort);
	});
	factorioPorts.forEach((port, index) => {
		let longestPort = 0;
		factorioPorts.forEach((port, index) => {
			if(port.toString().length > longestPort) longestPort = port.toString().length;
		});
		while(port.toString().length < longestPort){
			port += " ";
		}
		factorioPorts[index] = port;
	});
	instanceNames.forEach(function(instance, index){
		displayLines[index] += " " + factorioPorts[index] + " |";
	});
	
	displayLines.forEach(line => console.log(line));
	process.exit(0);
} else if (command == "manage"){
	// console.log("Launching mod manager");
	//const fullUsage = 'node client.js manage [instance, "shared"] ["mods", "config"] ...';
	function usage(instance, tool, action){
		if(tool && tool == "mods"){
			console.log('node client.js manage '+instance+' '+tool+' ["list", "search", "add", "remove", "update"]');
		} else if(tool && tool == "config") {
			console.log('node client.js manage '+instance+' '+tool+' ["list", "edit"]');
		} else {
			console.log('node client.js manage '+(instance || '[instance, "shared"]') +' '+ (tool || '["mods", "config"]') + ' ...');
		}
	}
	const tool = process.argv[4] || "";
	const action = process.argv[5] || "";
	if(instance){
		if(tool == "mods"){
			(async function(){try{
				// do require down here to reduce master load time
				const modManager = require("./lib/manager/modManager.js")(config);
				
				// allow managing mods
				if(action == "list"){
					console.log(await modManager.listMods(instance));
				} else if(action == "search"){
					console.log(await modManager.findMods(process.argv[6]));
				} else if(action == "add" || action == "download"){
					await modManager.addMod(process.argv[6], instance);
				} else if(action == "remove" || action == "rm" || action == "delete"){
					await modManager.removeMod(process.argv[6], instance);
				} else if(action == "update"){
					await modManager.updateAllMods();
				} else {
					usage(instance, tool);
				}
				process.exit(0);
			}catch(e){
				console.log("Got error from modManager:")
				console.log(e);
			}})();
		} else if(tool == "config"){
			// allow managing the config
			if(action == "list" || action == "show" || action == "display"){
				configManager.displayConfig(instance);
			} else if(action == "edit"){
				let newConfigValue = "";
				process.argv.forEach((arg, i)=>{
					if(i >= 8){
						newConfigValue += " "+arg;
					} else if(i >= 7){
						newConfigValue += arg;
					}
				});
				configManager.editConfig(instance, process.argv[6], newConfigValue);
			} else {
				usage(instance, tool);
			}
		} else {
			usage(instance);
		}
	} else {
		console.log('Usage:');
		usage(instance);
	}
	// process.exit(0);
} else if (command == "delete") {
	if (!process.argv[3]) {
		console.error("Usage: node client.js delete [instance]");
		process.exit(1);
	} else if (typeof process.argv[3] == "string" && fs.existsSync(config.instanceDirectory+"/" + process.argv[3]) && process.argv[3] != "/" && process.argv[3] != "") {
		fileOps.deleteFolderRecursiveSync(path.resolve(config.instanceDirectory, process.argv[3])); // TODO: Check if this can cause i-craft users to format their server by using wrong paths
		console.log("Deleted instance " + process.argv[3]);
		process.exit(0);
	} else {
		console.error("Instance not found: " + process.argv[3]);
		process.exit(0);
	}
} else if (command == "download") {
	console.log("Downloading mods...");
	// get JSON data about releases
	let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"Fuck you for requiring user agents!"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	if(url) {
		console.log(url);
		let file = fs.createWriteStream("sharedMods/"+name);
		https.get(url, function(response) {
			response.on('end', function () {
				console.log("Downloaded "+name);
				process.exit(0);
			});
			response.pipe(file);
		}).end();
	}
} else if (command == "start" && instance === undefined) {
	console.error("ERROR: No instanceName provided!");
	console.error("Usage: node client.js start [instanceName]");
	process.exit(0);
} else if (command == "start" && typeof instance == "string" && instance != "/" && !fs.existsSync(instancedirectory)) {
	// if instance does not exist, create it
	console.log("Creating instance...");
	fs.mkdirSync(instancedirectory);
	fs.mkdirSync(instancedirectory + "/script-output/");
	fs.mkdirSync(instancedirectory + "/saves/");
	fs.writeFileSync(instancedirectory + "/script-output/output.txt", "");
	fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
	fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
	fs.mkdirSync(instancedirectory + "/mods/");
	fs.mkdirSync(instancedirectory + "/instanceMods/");
    fs.mkdirSync(instancedirectory + "/scenarios/");
    ncp("./lib/scenarios", path.resolve(instancedirectory, "scenarios"), err => {
        if (err) console.error(err)
    });

	// fs.symlinkSync('../../../sharedMods', instancedirectory + "/mods", 'junction') // This is broken because it can only take a file as first argument, not a folder
	fs.writeFileSync(instancedirectory + `/config.ini`, `[path]\r\n
read-data=${ path.resolve(config.factorioDirectory, "data") }\r\n
write-data=${ path.resolve(config.instanceDirectory, instance) }\r\n
	`);

	// this line is probably not needed anymore but Im not gonna remove it
	fs.copySync('sharedMods', path.join(instancedirectory, "mods"));
	let instconf = {
		"factorioPort": args.port || process.env.FACTORIOPORT || Math.floor(Math.random() * 65535),
		"clientPort": args["rcon-port"] || process.env.RCONPORT || Math.floor(Math.random() * 65535),
		"clientPassword": args["rcon-password"] || Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8),
	}
	console.log("Clusterio | Created instance with settings:")
	console.log(instconf);

	// create instance config
	fs.writeFileSync(instancedirectory + "/config.json", JSON.stringify(instconf, null, 4));

	let name = "Clusterio instance: " + instance;
	if (config.username) {
		name = config.username + "'s clusterio " + instance;
	}
	let serversettings = {
		"name": name,
		"description": config.description,
		"tags": ["clusterio"],
		"max_players": "20",
		"visibility": config.visibility,
		"username": config.username,
		"token": config.token,
		"game_password": config.game_password,
		"verify_user_identity": config.verify_user_identity,
		"admins": [config.username],
		"allow_commands": config.allow_commands,
		"autosave_interval": 10,
		"autosave_slots": 5,
		"afk_autokick_interval": 0,
		"auto_pause": config.auto_pause,
	};
	fs.writeFileSync(instancedirectory + "/server-settings.json", JSON.stringify(serversettings, null, 4));
    console.log("Server settings: "+JSON.stringify(serversettings, null, 4));
    console.log("Creating save .....");
    let factorio = child_process.spawn(
        './' + config.factorioDirectory + '/bin/x64/factorio', [
            '-c', instancedirectory + '/config.ini',
            // '--create', instancedirectory + '/saves/save.zip',
            '--start-server-load-scenario', 'Hotpatch',
            '--server-settings', instancedirectory + '/server-settings.json',
            '--rcon-port', Number(process.env.RCONPORT) || instconf.clientPort,
            '--rcon-password', instconf.clientPassword,
        ], {
            'stdio': ['pipe', 'pipe', 'pipe']
        }
    );
    factorio.stdout.on("data", data => {
        data = data.toString("utf8").replace(/(\r\n\t|\n|\r\t)/gm,"");
        console.log(data);
        if(data.includes("Starting RCON interface")){
            let client = new Rcon();
            client.connect({
                host: 'localhost',
                port: Number(process.env.RCONPORT) || instconf.clientPort,
                password: instconf.clientPassword,
                timeout: 5000
            });
            client.onDidAuthenticate(() => {
                console.log('Clusterio | RCON Authenticated!');
            });
            client.onDidConnect(() => {
                console.log('Clusterio | RCON Connected, starting save');
                client.send("/c game.server_save('hotpachSave')");
            });
        }
        if(data.includes("Saving finished")){
            console.log("Map saved as hotpachSave.zip, exiting...");
            console.log("Instance created!")
            process.exit(0);
        }
		if(data.includes("Downloading from auth server failed")){
			console.error("Instance creation failed, unable to establish auth server connection.");
			console.error("Deleting broken instance...");
			
			fileOps.deleteFolderRecursiveSync(path.resolve(config.instanceDirectory, process.argv[3]));
			
			process.exit(0);
		}
    });
} else if (command == "start" && typeof instance == "string" && instance != "/" && fs.existsSync(instancedirectory)){
	// Exit if no instance specified (it should be, just a safeguard);
	if(instancedirectory != config.instanceDirectory+"/undefined"){
		var instanceconfig = require(path.resolve(instancedirectory,'config'));
		instanceconfig.unique = stringUtils.hashCode(instanceconfig.clientPassword);
		if(process.env.FACTORIOPORT){
			instanceconfig.factorioPort = process.env.FACTORIOPORT;
		}
		if(process.env.RCONPORT){
			instanceconfig.rconPort = process.env.RCONPORT;
		}
	} else {
		process.exit(1);
	}
	console.log("Deleting .tmp.zip files");
	let savefiles = fs.readdirSync(path.join(instancedirectory,"saves"));
	for(i = 0; i < savefiles.length; i++){
		if(savefiles[i].substr(savefiles[i].length - 8, 8) == ".tmp.zip") {
			fs.unlinkSync(path.resolve(instancedirectory, "saves", savefiles[i]));
		}
	}
	console.log("Deleting logs");
	// clean old log file to avoid crash
	// file exists, delete so we don't get in trouble
	try {
		fs.unlinkSync(path.join(instancedirectory,'factorio-current.log'));
	} catch (err){
		if(err){
			console.error(err);
		} else {
			console.log("Clusterio | Deleting old logs...");
		}
	}
	
	// move mods from ./sharedMods to the instances mod directory
	try{fs.mkdirSync(path.join(instancedirectory, "instanceMods"));}catch(e){}
	try{rmdirSync(path.join(instancedirectory, "mods"));}catch(e){}
	try {
		// mods directory that will be emptied (deleted) when closing the server to facilitate seperation of instanceMods and sharedMods
		fs.mkdirSync(path.join(instancedirectory, "mods"));
	} catch(e){}
	console.log("Clusterio | Moving shared mods from sharedMods/ to instance/mods...");
	fs.copySync('sharedMods', path.join(instancedirectory, "mods"));
	console.log("Clusterio | Moving instance specific mods from instance/instanceMods to instance/mods...");
	fs.copySync(path.join(instancedirectory, "instanceMods"), path.join(instancedirectory, "mods"));

	process.on('SIGINT', function () {
		console.log("Caught interrupt signal, sending /quit");
		messageInterface("/quit");
	});

	// Spawn factorio server
	//var serverprocess = child_process.exec(commandline);
	fileOps.getNewestFile(instancedirectory + "/saves/", fs.readdirSync(instancedirectory + "/saves/"),function(err, latestSave) {
		if(err) {
			console.error("ERROR!");
			console.error("Your savefile seems to be missing. This might because you created an instance without having factorio\
 installed and configured properly. Try installing factorio and adding your savefile to instances/[instancename]/saves/\n");
			throw err;
		}
		// implicit global
		serverprocess = child_process.spawn(
			'./' + config.factorioDirectory + '/bin/x64/factorio', [
				'-c', instancedirectory + '/config.ini',
				'--start-server', latestSave.file,
				'--rcon-port', args["rcon-port"] || Number(process.env.RCONPORT) || instanceconfig.clientPort,
				'--rcon-password', args["rcon-password"] || instanceconfig.clientPassword,
				'--server-settings', instancedirectory + '/server-settings.json',
				'--port', args.port || Number(process.env.FACTORIOPORT) || instanceconfig.factorioPort
			], {
				'stdio': ['pipe', 'pipe', 'pipe']
			}
		);

		serverprocess.on('close', code => {
			console.log(`child process exited with code ${code}`);
			process.exit();
		});
		serverprocess.stdout.on("data", data => {
			// log("Stdout: " + data);
			if(data.toString('utf8').includes("Couldn't parse RCON data: Maximum payload size exceeded")){
				console.error("ERROR: RCON CONNECTION BROKE DUE TO TOO LARGE PACKET!");
				console.error("Attempting reconnect...");
				client.disconnect();
				client.connect();
			}
			// we have to do this to make logs visible on linux and in powershell. Causes log duplication for people with CMD.
			console.log('Fact: ' + data.toString("utf8").replace("\n", ""));
		});
		serverprocess.stderr.on('data', (chunk) => {
			console.log('ERR: ' + chunk);
		});

		// connect to the server with rcon
		if(true || process.platform != "linux"){
			// IP, port, password
			client = new Rcon();
			
			// check the logfile to see if the RCON interface is running as there is no way to continue without it
			// we read the log every 2 seconds and stop looping when we start connecting to factorio
			function checkRcon() {
				fs.readFile(instancedirectory+"/factorio-current.log", function (err, data) {
					// if (err) console.error(err);
					if(data && data.indexOf('Starting RCON interface') > 0){
						client.connect({
							host: 'localhost',
							port: args["rcon-port"] || Number(process.env.RCONPORT) || instanceconfig.clientPort,
							password: args["rcon-password"] || instanceconfig.clientPassword,
							timeout: 5000
						});
					} else {
						setTimeout(function(){
							checkRcon();
						},5000);
					}
				});
			}
			setTimeout(checkRcon, 5000);
		
			client.onDidAuthenticate(() => {
				console.log('Clusterio | RCON Authenticated!');
				instanceManagement(); // start using rcons
			});
			client.onDidConnect(() => {
				console.log('Clusterio | RCON Connected!');
				// getID();
			});
			client.onDidDisconnect(() => {
				console.log('Clusterio | RCON Disconnected!');
				process.exit(0); // exit because RCON disconnecting is undefined behaviour and we rather just wanna restart now
			});
		} else if(process.platform == "linux"){
			// don't open an RCON connection and just use stdio instead, does not work on windows.
			instanceManagement();
		}

		// set some globals
		confirmedOrders = [];
		lastSignalCheck = Date.now();
	});
} else {
	console.error("Invalid arguments, quitting.");
	process.exit(1);
}

// ensure instancemanagement only ever runs once
_.once(instanceManagement);
function instanceManagement() {
    console.log("Started instanceManagement();");

    /* Open websocket connection to master */
	var socket = ioClient("http://"+config.masterIP+":"+config.masterPort);
	socket.on("hello", data => {
		console.log("SOCKET | registering slave!");
		socket.emit("registerSlave", {
			instanceID: instanceconfig.unique,
		});
	});
	setInterval(B=> socket.emit("heartbeat"), 10000);

	// load plugins and execute onLoad event
	let pluginDirectories = fileOps.getDirectoriesSync("./sharedPlugins/");
	let plugins = [];
	for(let i=0; i<pluginDirectories.length; i++) {
		let I = i
		let log = function(message) {
			console.log("Clusterio | "+ pluginDirectories[I] + " | " + message);
		}
		// these are our two config files. We need to send these in case plugin
		// wants to contact master or know something.
		let combinedConfig = deepmerge(instanceconfig,config,{clone:true})
        let pluginConfig = require("./sharedPlugins/" + pluginDirectories[i] + "/config.js");
		
		if(!global.subscribedFiles) {
			global.subscribedFiles = {};
		}
		if(pluginConfig.binary == "nodePackage"){
			// require index.js.main() of plugin and execute it as a class
			let pluginClass = require("./sharedPlugins/" + pluginDirectories[I] + "/index.js");
			plugins[I] = new pluginClass(combinedConfig, async function(data, callback){
				if(data.toString('utf8')[0] != "/") {
					log("Stdout: " + data.toString('utf8'));
					return true;
				} else {
					return messageInterface(data.toString('utf8'), callback);
				}
			}, { // extra functions to pass in object. Should have done it like this from the start, but won't break backwards compat.
				socket, // socket.io connection to master (and ES6 destructuring, yay)
			});
			if(plugins[I].factorioOutput && typeof plugins[I].factorioOutput === "function"){
				// when factorio logs a line, send it to the plugin. This includes things like autosaves, chat, errors etc
				serverprocess.stdout.on("data", data => plugins[I].factorioOutput(data.toString()));
			}
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string"){
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginDirectories[i] + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				if (!fs.existsSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription)) {
					// Do something
					fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				console.log("Clusterio | Registered file subscription on "+instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription);
				fs.watch(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, fileChangeHandler);
				// run once in case a plugin wrote out information before the plugin loaded fully

				// delay, so the socket got enough time to connect
				setTimeout(()=> {
                    fileChangeHandler(false, pluginConfig.scriptOutputFileSubscription);
                }, 500);
				
				// send file contents to plugin for processing
				function fileChangeHandler(eventType, filename) {
					if(filename != null){
						setTimeout(
							()=>{
								// get array of lines in file
								let stuff = fs.readFileSync(instancedirectory + "/script-output/" + filename, "utf8").split("\n");

								// if you found anything, reset the file
								if (stuff[0]) {
									fs.writeFileSync(instancedirectory + "/script-output/" + filename, "");
								}
								for(let i = 0; i < stuff.length; i++) {
									if(stuff[i] && !stuff[i].includes('\u0000\u0000')) {
										try{
											plugins[I].scriptOutput(stuff[i]);
										}catch(e){console.error(e)}
									}
								}
							},
							pluginConfig.fileReadDelay || 0
						);
					}
				}
			}
			console.log("Clusterio | Loaded plugin " + pluginDirectories[i]);
		} else if(pluginConfig.binary != "nodePackage" && pluginConfig.binary){
			// handle as fragile executable plugin
			let args = pluginConfig.args || [];
			plugins[I]=child_process.spawn(pluginConfig.binary, args, {
				cwd: "./sharedPlugins/"+pluginDirectories[i],
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			
			/*
				to send to stdin, use:
				spawn.stdin.write("text\n");
			*/
			// If plugin has subscribed to a file, send any text appearing in that file to stdin
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string") {
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginDirectories[i] + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				if (!fs.existsSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription)) {
					// Do something
					fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				fs.watch(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, function (eventType, filename) {
					// get array of lines in file
					// TODO async
					let stuff = fs.readFileSync(instancedirectory + "/script-output/" + filename, "utf8").split("\n");
					// if you found anything, reset the file
					if (stuff[0]) {
						fs.writeFileSync(instancedirectory + "/script-output/" + filename, "");
					}
					for (let i = 0; i < stuff.length; i++) {
						if (stuff[i]) {
							plugins[I].stdin.write(stuff[i]);
						}
					}
				});
			}
			// these are our two config files. We need to send these in case plugin
			// wants to contact master or know something.
			// send through script-output file, maybe more compat?
			fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, JSON.stringify(combinedConfig)+"\r\n");
			// send directly through stdin
			// plugins[i].stdin.write(JSON.stringify(combinedConfig)+"\n");
			
			console.log("Clusterio | Loaded plugin " + pluginDirectories[i]);
			plugins[i].stdout.on("data", (data) => {
				if(data.toString('utf8')[0] != "/") {
					log("Stdout: " + data.toString('utf8'))
				} else {
					messageInterface(data.toString('utf8'));
				}
			});
			plugins[i].stderr.on("data", (data) => {
				log("STDERR: " + data);
			});
			plugins[i].on('close', (code) => {
				log(`child process exited with code ${code}`);
			});
		} else {
			// This plugin doesn't have a client portion
		}
    }

	// world IDs ------------------------------------------------------------------
	hashMods(instance, function(modHashes){
		setInterval(getID, 10000);
		getID();
		function getID() {
			messageInterface("/silent-command rcon.print(#game.connected_players)", function(playerCount) {
				var payload = {
					time: Date.now(),
					rconPort: instanceconfig.clientPort,
					rconPassword: instanceconfig.clientPassword,
					serverPort: instanceconfig.factorioPort,
					unique: instanceconfig.unique,
					publicIP: config.publicIP, // IP of the server should be global for all instances, so we pull that straight from the config
					mods:modHashes,
					instanceName: instance,
					playerCount:playerCount.replace(/(\r\n\t|\n|\r\t)/gm, ""),
				}
				
				function callback(err, mac) {
					if (err) {
						mac = "unknown";
						console.log("##### getMac crashed, but we don't really give a shit because we are probably closing down #####");
					}
					payload.mac = mac;
					console.log("Registered our presence with master "+config.masterIP+" at " + payload.time);
					needle.post(config.masterIP + ":" + config.masterPort + '/api/getID', payload, needleOptionsWithTokenAuthHeader, function (err, response, body) {
						if (err && err.code != "ECONNRESET"){
                            console.error("We got problems, something went wrong when contacting master"+config.masterIP+" at " + payload.time);
							console.error(err);
						} else if (response && response.body) {
							// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
							if(response.body !== "ok") {
                                console.log("Got no \"ok\" while registering our precense with master "+config.masterIP+" at " + payload.time);
                                console.log(response.body);
                            }
						}
					});
				}
				if(global.mac){
					callback(undefined, global.mac);
				} else {
					getMac(callback);
				}
			});
		}
	});
	// Mod uploading and management -----------------------------------------------
	// get mod names and hashes
	// string: instance, function: callback
	
	setTimeout(function(){hashMods(instance, uploadMods)}, 5000);
	function uploadMods(modHashes) {
		// [{modName:string,hash:string}, ... ]
		for(let i=0;i<modHashes.length;i++){
			let payload = {
				modName: modHashes[i].modName,
				hash: modHashes[i].hash,
			}
			needle.post(config.masterIP + ":" + config.masterPort + '/api/checkMod', payload, needleOptionsWithTokenAuthHeader, function (err, response, body) {
				if(err) console.error("Unable to contact master server /api/checkMod! Please check your config.json.");
				if(response && body && body == "found") {
					console.log("master has mod "+modHashes[i].modName);
				} else if (response && body && typeof body == "string") {
					let mod = response.body;
					if(config.uploadModsToMaster){
						console.log("Sending mod: " + mod);
						// Send mods master says it wants
						// response.body is a string which is a modName.zip
						var req = request.post({url: "http://"+config.masterIP + ":" + config.masterPort + '/api/uploadMod',
							headers: {
								"x-access-token": config.masterAuthToken,
							},
						}, function (err, resp, body) {
							if (err) {
								console.error(new Error("Unable to contact master server /api/uploadMod! Please check your config.json."));
							} else {
								console.log('URL: ' + body);
							}
						});
						var form = req.form();
						form.append('file', fs.createReadStream(config.instanceDirectory+"/"+instance+"/mods/"+mod));
					} else {
						console.log("Not sending mod: " + mod + " to master because config.uploadModsToMaster is not enabled")
					}
				}
			});
		}
	}
	
	// flow/production statistics ------------------------------------------------------------
	oldFlowStats = false
	setInterval(function(){
		fs.readFile(instancedirectory + "/script-output/flows.txt", {encoding: "utf8"}, function(err, data) {
			if(!err && data) {
				let timestamp = Date.now();
				data = data.split("\n");
				let flowStats = [];
				for(let i = 0; i < data.length; i++) {
					// try catch to remove any invalid json
					try{
						flowStats[flowStats.length] = JSON.parse(data[i]);
					} catch (e) {
						// console.log(" invalid json: " + i);
						// some lines of JSON are invalid but don't worry, we just filter em out
					}
				}
				// fluids
				let flowStat1 = flowStats[flowStats.length-1].flows.player.input_counts
				// items
				let flowStat2 = flowStats[flowStats.length-2].flows.player.input_counts
				// merge fluid and item flows
				let totalFlows = {};
				for(let key in flowStat1) totalFlows[key] = flowStat1[key];
				for(let key in flowStat2) totalFlows[key] = flowStat2[key];
				if(oldFlowStats && totalFlows && oldTimestamp) {
					let payload = objectOps.deepclone(totalFlows);
					// change from total reported to per time unit
					for(let key in oldFlowStats) {
						// get production per minute
						payload[key] = Math.floor((payload[key] - oldFlowStats[key])/(timestamp - oldTimestamp)*60000);
						if(payload[key] < 0) {
							payload[key] = 0;
						}
					}
					for(let key in payload) {
						if(payload[key] == '0') {
							delete payload[key];
						}
					}
					console.log("Recorded flows, copper plate since last time: " + payload["copper-plate"]);
					needle.post(config.masterIP + ":" + config.masterPort + '/api/logStats', {timestamp: timestamp, instanceID: instanceconfig.unique,data: payload}, needleOptionsWithTokenAuthHeader, function (err, response, body) {
						// we did it, keep going
					});
				}
				oldTimestamp = timestamp;
				oldFlowStats = totalFlows;
				fs.writeFileSync(instancedirectory + "/script-output/flows.txt", "");
			}
		});
		// we don't need to update stats quickly as that could be expensive
	}, 60000*5);
	
	// provide items --------------------------------------------------------------
	// trigger when something happens to output.txt
	fs.watch(instancedirectory + "/script-output/output.txt", function (eventType, filename) {
		// get array of lines in file
		let items = fs.readFileSync(instancedirectory + "/script-output/output.txt", "utf8").split("\n");
		// if you found anything, reset the file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/output.txt", "");
		}
		for (let i = 0; i < items.length; i++) {
			if (items[i]) {
				let g = items[i].split(" ");
				g[0] = g[0].replace("\u0000", "");
				// console.log("exporting " + JSON.stringify(g));
				// send our entity and count to the master for him to keep track of
				needle.post(config.masterIP + ":" + config.masterPort + '/api/place', {
					name: g[0],
					count: g[1],
					instanceName: instance, // name of instance
					instanceID: instanceconfig.unique, // a hash computed from the randomly generated rcon password
				}, needleOptionsWithTokenAuthHeader, function (err, resp, body) {
					if(body == "failure") console.error("#### Export failed! Lost: "+g[1]+" "+g[0]);
					if(config.logItemTransfers){
						if(body == "success") console.log(`Exported ${g[1]} ${g[0]} to master`);
					}
				});
			}
		}
	});
	// request items --------------------------------------------------------------
	setInterval(function () {
		// get array of lines in file
		let items = fs.readFileSync(instancedirectory + "/script-output/orders.txt", "utf8").split("\n");
		// if we actually got anything from the file, proceed and reset file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
			// prepare a package of all our requested items in a more tranfer friendly format
			var preparedPackage = {};
			for (let i = 0; i < items.length; i++) {
				(function (i) {
					if (items[i]) {
						items[i] = items[i].split(" ");
						items[i][0] = items[i][0].replace("\u0000", "");
						items[i][0] = items[i][0].replace(",", "");
						if (preparedPackage[items[i][0]]) {
							// if we have buffered some already, sum the new items
							if (typeof Number(preparedPackage[items[i][0]].count) == "number" && typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(preparedPackage[items[i][0]].count) + Number(items[i][1]),
									"instanceName":instance,
									"instanceID":instanceconfig.unique,
								};
							// else just add em in without summing
							} else if (typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(items[i][1]),
									"instanceName":instance,
									"instanceID":instanceconfig.unique,
								};
							}
						// this condition will NEVER be triggered but we know how that goes
						} else if (typeof Number(items[i][1]) == "number") {
							preparedPackage[items[i][0]] = {
								"name": items[i][0],
								"count": Number(items[i][1]),
								"instanceName":instance,
								"instanceID":instanceconfig.unique,
							};
						}
					}
				})(i);
			}
			// request our items, one item at a time
			for (let i = 0; i < Object.keys(preparedPackage).length; i++) {
				// console.log(preparedPackage[Object.keys(preparedPackage)[i]]);
				needle.post(config.masterIP + ":" + config.masterPort + '/api/remove', preparedPackage[Object.keys(preparedPackage)[i]], needleOptionsWithTokenAuthHeader, function (err, response, body) {
					if (response && response.body && typeof response.body == "object") {
						// buffer confirmed orders
						confirmedOrders[confirmedOrders.length] = {name:response.body.name,count:response.body.count}
						if(config.logItemTransfers){
							console.log(`Imported ${response.body.count} ${response.body.name} from master`);
						}
					}
				});
			}
			// if we got some confirmed orders
			// console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
			//if (!(confirmedOrders.length>0)){return;}
			let cmd="local t={";
			for(let i=0;i<confirmedOrders.length;i++)
			{
			    cmd+='["'+confirmedOrders[i].name+'"]='+confirmedOrders[i].count+',';
			    if(cmd.length>320) // Factorio max packet size is 508
			    {
			        messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+cmd.slice(0, -1)+"}"+ " for k, item in pairs(t) do GiveItemsToStorage(k, item) end')");
			        cmd="local t={";
			    }
			}
			if (!(cmd==="local t={")){
				messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+cmd.slice(0, -1)+"}"+ " for k, item in pairs(t) do GiveItemsToStorage(k, item) end')");
			}
			confirmedOrders=[];
		}
	}, 1000);
	// COMBINATOR SIGNALS ---------------------------------------------------------
	// get inventory from Master and RCON it to our slave
	setInterval(function () {
		needle.get(config.masterIP + ":" + config.masterPort + '/api/inventory', function (err, response, body) {
			if(err){
				console.error("Unable to get JSON master/api/inventory, master might be unaccessible");
			} else if (response && response.body) {
				// Take the inventory we (hopefully) got and turn it into the format LUA accepts
				if(Buffer.isBuffer(response.body)) {console.log(response.body.toString("utf-8")); throw new Error();} // We are probably contacting the wrong webserver
				try {
					var inventory = JSON.parse(response.body);
					var inventoryFrame = {};
					for (let i = 0; i < inventory.length; i++) {
						inventoryFrame[inventory[i].name] = Number(inventory[i].count);
						if(inventoryFrame[inventory[i].name] >= Math.pow(2, 31)){
							inventoryFrame[inventory[i].name] = Math.pow(2, 30); // set it waaay lower, 31 -1 would probably suffice
						}
					}
					inventoryFrame["signal-unixtime"] = Math.floor(Date.now()/1000);
					// console.log("RCONing inventory! " + JSON.stringify(inventoryFrame));
					let first = true;
					let cmd="local s={";
					for (let key in inventoryFrame)
					{
						cmd+='["'+key+'"]='+inventoryFrame[key]+",";
						if(first && cmd.length>300 || !first && cmd.length > 320) // Factorio max packet size is 508
						{
					       		messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+(first ? 'global.ticksSinceMasterPinged=0 ':'')+cmd.slice(0, -1)+"}"+ " for name,count in pairs(s) do global.invdata[name]=count end')");
					       		cmd="local s={";
					       		first = false;
						}
					}
					if (!(cmd==="local s={")){
						messageInterface("/silent-command remote.call('clusterio', 'runcode', '"+(first ? 'global.ticksSinceMasterPinged=0 ':'')+cmd.slice(0, -1)+"}"+ " for name,count in pairs(s) do global.invdata[name]=count end')");
					}
					messageInterface("/silent-command remote.call('clusterio', 'runcode', 'UpdateInvCombinators()')");
				} catch (e){
					console.log(e);
				}
			}
		});
	}, 1550);
	// Make sure world has its worldID
	setTimeout(function(){
		messageInterface("/silent-command remote.call('clusterio','setWorldID',"+instanceconfig.unique+")")
	}, 20000);
	/* REMOTE SIGNALLING
	 * send any signals the slave has been told to send
	 * Fetch combinator signals from the server
	*/
	socket.on("processCombinatorSignal", circuitFrameWithMeta => {
		if(circuitFrameWithMeta && typeof circuitFrameWithMeta == "object" && circuitFrameWithMeta.frame && Array.isArray(circuitFrameWithMeta.frame)){
			messageInterface("/silent-command remote.call('clusterio', 'receiveFrame', '"+JSON.stringify(circuitFrameWithMeta.frame)+"')");
		}
	});
	// get outbound frames from file and send to master
	// get array of lines in file, each line should correspond to a JSON encoded frame
	let signals = fs.readFileSync(instancedirectory + "/script-output/txbuffer.txt", "utf8").split("\n");
	// if we actually got anything from the file, proceed and reset file
	let readingTxBufferSoon = false;
	let txBufferClearCounter = 0;
	fs.watch(instancedirectory + "/script-output/txbuffer.txt", "utf-8", (eventType, filename) => {
		if(!readingTxBufferSoon){ // use a 100ms delay to avoid messing with rapid sequential writes from factorio (I think that might be a problem maybe?)
			readingTxBufferSoon = true;
			setTimeout(()=>{
				txBufferClearCounter++;
				fs.readFile(instancedirectory + "/script-output/txbuffer.txt", "utf-8", (err, signals) => {
					signals = signals.split("\n");
					if (signals[0]) {
						//if(txBufferClearCounter > 500){
							fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
						//	txBufferClearCounter = 0;
						//}
						
						// loop through all our frames
						for (let i = 0; i < signals.length; i++) {
							if (signals[i] && objectOps.isJSON(signals[i])) {
								// signals[i] is a JSON array called a "frame" of signals. We timestamp it for storage on master
								// then we unpack and RCON in this.frame to the game later.
								let framepart = JSON.parse(signals[i]);
								let doneframe = {
									time: Date.now(),
									frame: framepart, // thats our array of objects(single signals);
								}
								// send to master using socket.io, opened at the top of instanceManagement()
								socket.emit("combinatorSignal", doneframe);
							} else {
								// console.log("Invalid jsony: "+typeof signals[i])
							}
						}
					}
				});
				readingTxBufferSoon = false;
			},100);
		}
	});
} // END OF INSTANCE START ---------------------------------------------------------------------

// string, function
// returns [{modName:string,hash:string}, ... ]
function hashMods(instanceName, callback) {
	if(!callback) {
		throw new Error("ERROR in function hashMods NO CALLBACK");
	}
	function callback2(hash, modName){
		hashedMods[hashedMods.length] = {
			modName: modName,
			hash: hash,
		}
		// check if this callback has ran once for each mod
		if(hashedMods.length == instanceMods.length) {
			callback(hashedMods);
		}
		//console.log(modname);
	}
	let hashedMods = [];
	/*let mods = fs.readdirSync("./sharedMods/")*/
	let instanceMods = fs.readdirSync(config.instanceDirectory+"/"+instanceName+"/mods/");
	if(instanceMods.length == 0){
		callback({}); // there are no mods installed, return an empty object
	}
	for(let o=0;o<instanceMods.length;o++) {
		if(path.extname(instanceMods[o]) != ".zip") {
			instanceMods.splice(instanceMods.indexOf(instanceMods[o]), 1); // remove element from array, we can't hash unzipped mods
		}
	}
	for(let i=0; i<instanceMods.length; i++){
		let path = config.instanceDirectory+"/"+instanceName+"/mods/"+instanceMods[i];
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