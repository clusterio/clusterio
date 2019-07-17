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
	console.error("To download a clusterio plugin, do");
	console.error("node client.js manage shared plugins install https://github.com/Danielv123/playerManager");
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
		} else if(tool && tool == "plugins") {
			console.log(`node client.js manage ${instance} ${tool} ["list", "add", "remove"]`);
		} else {
			console.log('node client.js manage '+(instance || '[instance, "shared"]') +' '+ (tool || '["mods", "config", "plugins"]') + ' ...');
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
		} else if(tool == "plugins"){
			(async function(){try{
				const pluginManager = require("./lib/manager/pluginManager.js")(config);
				if(action == "list"){
					await pluginManager.listPlugins();
				} else if(action == "add" || action == "install" || action == "download"){
					let status = await pluginManager.addPlugin(process.argv[6]);
				} else if(action == "remove" || action == "uninstall" || action == "delete"){
					let status = await pluginManager.removePlugin(process.argv[6]);
					if(status && status.msg) console.log(status.msg);
				} else if(action == "enable"){
					let status = await pluginManager.enablePlugin(process.argv[6]);
					if(status && status.msg) console.log(status.msg);
				} else if(action == "disable"){
					let status = await pluginManager.disablePlugin(process.argv[6]);
					if(status && status.msg) console.log(status.msg);
				}
				process.exit(0);
			}catch(e){
				console.error(e);
				process.exit(1);
			}})();
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
		"__comment_clientPassword": "This is the rcon password. Its also used for making an instanceID. Make sure its unique and not blank.",
		"clientPassword": args["rcon-password"] || Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8),
		"info": {}
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
            let client = new Rcon({
				packetResponseTimeout: 200000,
			    maxPending: 5
			});
            client.connect({
                host: 'localhost',
                port: Number(process.env.RCONPORT) || instconf.clientPort,
                password: instconf.clientPassword
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
} else if (command == "start" && typeof instance == "string" && instance != "/" && fs.existsSync(instancedirectory)){(async () => {
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
	console.log("Clusterio | Rotating old logs...");
	// clean old log file to avoid crash
	try{
		let logPath = path.join(instancedirectory,'factorio-current.log');
		let stat = await fs.stat(logPath);
		console.log(stat)
		console.log(stat.isFile())
		if(stat.isFile()){
			let logFilename = `factorio-${Math.floor(Date.parse(stat.mtime)/1000)}.log`;
			await fs.rename(logPath, path.join(instancedirectory, logFilename));
			console.log(`Log rotated as ${logFilename}`);
		}
	}catch(e){}
	// Math.floor(Date.now()/1000)
	// (new Date).toGMTString()
	
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
	
	// Set paths for factorio so it reads and writes from the correct place even if the instance is imported from somewhere else
	fs.writeFileSync(instancedirectory + `/config.ini`, `[path]\r\n
read-data=${ path.resolve(config.factorioDirectory, "data") }\r\n
write-data=${ path.resolve(config.instanceDirectory, instance) }\r\n
	`);
	
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
			client = new Rcon({
				packetResponseTimeout: 200000, // 200s, should allow for commands up to 1250kB in length
			    maxPending: 5
			});
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
				instanceManagement(instanceconfig); // start using rcons
			});
			client.onDidConnect(() => {
				console.log('Clusterio | RCON Connected!');
				// getID();
			});
			client.onDidDisconnect(() => {
				console.log('Clusterio | RCON Disconnected!');
				// process.exit(0); // exit because RCON disconnecting is undefined behaviour and we rather just wanna restart now
			});
			process.on('SIGINT', function () {
				console.log("Caught interrupt signal, disconnecting RCON");
				client.disconnect().then(()=>{
					console.log("Rcon disconnected, Sending ^C");
					// We don't actually do this on windows, because ctrl+c in windows CMD sends it to all subprocesses as well. Doing it twice will abort factorios save.
					if(process.platform == "linux"){
						serverprocess.kill("SIGINT");
					}
				});
			});
		} else if(process.platform == "linux"){
			// don't open an RCON connection and just use stdio instead, does not work on windows.
			instanceManagement(instanceconfig);
			process.on('SIGINT', function () {
				console.log("Caught interrupt signal, sending ^C");
				serverprocess.kill("SIGINT");
			});
		}

		// set some globals
		confirmedOrders = [];
		lastSignalCheck = Date.now();
	});
})()} else {
	console.error("Invalid arguments, quitting.");
	process.exit(1);
}

// ensure instancemanagement only ever runs once
_.once(instanceManagement);
async function instanceManagement(instanceconfig) {
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
	const pluginManager = require("./lib/manager/pluginManager.js")(config);
	let pluginsToLoad = await pluginManager.getPlugins();
	let plugins = [];
	
	for(let i = 0; i < pluginsToLoad.length; i++){
		let pluginLoadStarted = Date.now();
		let log = function(message) {
			console.log("Clusterio | "+ pluginsToLoad[i].name + " | " + message);
		}
		let combinedConfig = deepmerge(instanceconfig,config,{clone:true});
		let pluginConfig = pluginsToLoad[i];
		
		if(!global.subscribedFiles) {
			global.subscribedFiles = {};
		}
		if(pluginConfig.binary == "nodePackage" && pluginConfig.enabled){
			// require plugin class and execute it
			let pluginClass = require(path.resolve(pluginConfig.pluginPath, "index.js"));
			plugins[i] = new pluginClass(combinedConfig, async function(data, callback){
				if(data && data.toString('utf8')[0] != "/") {
					log(data.toString('utf8'));
					return true;
				} else if (data && data.toString('utf8')[0] == "/"){
					return messageInterface(data.toString('utf8'), callback);
				}
			}, { // extra functions to pass in object. Should have done it like this from the start, but won't break backwards compat.
				socket, // socket.io connection to master (and ES6 destructuring, yay)
			});
			if(plugins[i].factorioOutput && typeof plugins[i].factorioOutput === "function"){
				// when factorio logs a line, send it to the plugin. This includes things like autosaves, chat, errors etc
				serverprocess.stdout.on("data", data => plugins[i].factorioOutput(data.toString()));
			}
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string"){
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginConfig.name + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
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
								for(let o = 0; o < stuff.length; o++) {
									if(stuff[o] && !stuff[o].includes('\u0000\u0000')) {
										try{
											plugins[i].scriptOutput(stuff[o]);
										}catch(e){console.error(e)}
									}
								}
							},
							pluginConfig.fileReadDelay || 0
						);
					}
				}
			}
			console.log(`Clusterio | Loaded plugin ${pluginsToLoad[i].name} in ${Date.now() - pluginLoadStarted}ms`);
		} else {
			// this plugin doesn't have a client portion. Maybe it runs on the master only?
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
					info: instanceconfig.info,
				}
				if(playerCount){
					payload.playerCount = playerCount.replace(/(\r\n\t|\n|\r\t)/gm, "");
				} else {
					payload.playerCount = 0;
				}
				
				function callback(err, mac) {
					if (err) {
						mac = "unknown";
						console.log("##### getMac crashed, but we don't really give a shit because we are probably closing down #####");
					}
					global.mac = mac;
					payload.mac = mac;
					// console.log("Registered our presence with master "+config.masterIP+" at " + payload.time);
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
