const fs = require('fs-extra');
const Tail = require('tail').Tail;
const https = require('follow-redirects').https;
const needle = require("needle");
const child_process = require('child_process');
const path = require('path');
const syncRequest = require('sync-request');
const request = require("request");
const deepmerge = require("deepmerge");
const getMac = require('getmac').getMac;
const ioClient = require("socket.io-client");
const asTable = require("as-table").configure({delimiter: ' | '});
const util = require("util");

// internal libraries
const objectOps = require("lib/objectOps");
const fileOps = require("lib/fileOps");
const pluginManager = require("lib/manager/pluginManager");
const modManager = require("lib/manager/modManager");
const hashFile = require('lib/hash').hashFile;
const factorio = require("lib/factorio");

// Uhm...
var global = {};

/**
 * Keeps track of the runtime parameters of an instance
 */
class Instance {
	constructor(dir, name) {
		this._name = name;
		this._dir = dir;
	}

	/**
	 * Name of the instance
	 *
	 * This should not be used for filesystem paths.  See .path() for that.
	 */
	get name() {
		return this._name;
	}

	/**
	 * Return path in instance
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the directory of the instance.  For example instance.path("mods")
	 * returns a path to the mods directory of the instance.  If no parts are
	 * given it returns a path to the directory of the instance.
	 */
	path(...parts) {
		return path.join(this._dir, ...parts);
	}
}

function checkFilename(name) {
	// All of these are bad in Windows only, except for /, . and ..
	// See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
	const badChars = /[<>:"\/\\|?*\x00-\x1f]/g;
	const badEnd = /[. ]$/;

	const oneToNine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
	const badNames = [
		// Relative path components
		'.', '..',

		// Reserved filenames in Windows
		'CON', 'PRN', 'AUX', 'NUL',
		...oneToNine.map(n => `COM${n}`),
		...oneToNine.map(n => `LPT${n}`),
	];

	if (typeof name !== "string") {
		throw new Error("must be a string");
	}

	if (name === "") {
		throw new Error("cannot be empty");
	}

	if (badChars.test(name)) {
		throw new Error('cannot contain <>:"\\/|=* or control characters');
	}

	if (badNames.includes(name.toUpperCase())) {
		throw new Error(
			"cannot be named any of . .. CON PRN AUX NUL COM1-9 and LPT1-9"
		);
	}

	if (badEnd.test(name)) {
		throw new Error("cannot end with . or space");
	}
}

function needleOptionsWithTokenAuthHeader(config) {
	return {
		compressed: true,
		headers: {
			'x-access-token': config.masterAuthToken
		},
	};
}

function printUsage() {
	console.error("Usage: ");
	console.error("node client start [instance name]");
	console.error("node client list");
	console.error("node client delete [instance]");
	console.error("To download the latest version of the Clusterio lua mod, do");
	console.error("node client manage shared mods download clusterio");
	console.error("To download a clusterio plugin, do");
	console.error("node client manage shared plugins install https://github.com/Danielv123/playerManager");
	console.error("For more management options, do");
	console.error("node client manage");
}

async function listInstances(config) {
	let instanceNames = fileOps.getDirectoriesSync(config.instanceDirectory);
	let instances = [];
	for (instance of instanceNames) {
		let cfg = path.resolve(config.instanceDirectory, instance, 'config');
		let port = require(cfg).factorioPort;
		instances.push({
			"Name": instance,
			"Port": port.toString(),
		});
	}

	console.log(asTable(instances));
}

async function manage(config, instance) {
	// console.log("Launching mod manager");
	//const fullUsage = 'node client manage [instance, "shared"] ["mods", "config"] ...';
	function usage(instance, tool, action){
		if(tool && tool == "mods"){
			console.log('node client manage '+instance.name+' '+tool+' ["list", "search", "add", "remove"]');
		} else if(tool && tool == "plugins") {
			console.log(`node client manage ${instance.name} ${tool} ["list", "add", "remove"]`);
		} else {
			console.log('node client manage '+(instance && instance.name || '[instance, "shared"]') +' '+ (tool || '["mods", "plugins"]') + ' ...');
		}
	}
	const tool = process.argv[4] || "";
	const action = process.argv[5] || "";
	if (instance !== undefined) {
		if(tool == "mods"){
			(async function(){try{
				// allow managing mods
				if(action == "list"){
					console.log(await modManager.listMods(config, instance));
				} else if(action == "search"){
					console.log(await modManager.findMods(config, process.argv[6]));
				} else if(action == "add" || action == "download"){
					await modManager.addMod(config, process.argv[6], instance);
				} else if(action == "remove" || action == "rm" || action == "delete"){
					await modManager.removeMod(config, process.argv[6], instance);
				} else {
					usage(instance, tool);
				}
				process.exit(0);
			}catch(e){
				console.log("Got error from modManager:")
				console.log(e);
			}})();
		} else if(tool == "plugins"){
			(async function(){try{
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
}

async function deleteInstance(instance) {
	if (instance === undefined) {
		console.error("Usage: node client delete [instance]");
		process.exit(1);
	} else if (fs.existsSync(instance.path())) {
		fileOps.deleteFolderRecursiveSync(instance.path()); // TODO: Check if this can cause i-craft users to format their server by using wrong paths
		console.log("Deleted instance " + instance.name);
		process.exit(0);
	} else {
		console.error("Instance not found: " + instance.name);
		process.exit(0);
	}
}

async function downloadMod() {
	console.log("Downloading mods...");
	// get JSON data about releases
	let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"factorioClusterio"}});
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
}

/**
 * Create and update symlinks for shared mods in an instance
 *
 * Creates symlinks for .zip and .dat files that are not present in the
 * instance mods directory but is present in the sharedMods directory,
 * and removes any symlinks that don't point to a file in the instance
 * mods directory.  If the instance mods directory doesn't exist it will
 * be created.
 *
 * Note that on Windows this creates hard links instead of symbolic
 * links as the latter requires elevated privileges.  This unfortunately
 * means the removal of mods from the shared mods dir can't be detected.
 *
 * @param {Instance} instance - Instance to link mods for
 * @param {string} sharedMods - Path to folder to link mods from.
 * @param {object} logger - console like logging interface.
 */
async function symlinkMods(instance, sharedMods, logger) {
	await fs.ensureDir(instance.path("mods"));

	// Remove broken symlinks in instance mods.
	for (let entry of await fs.readdir(instance.path("mods"), { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			if (!await fs.pathExists(instance.path("mods", entry.name))) {
				logger.log(`Removing broken symlink ${entry.name}`);
				await fs.unlink(instance.path("mods", entry.name));
			}
		}
	}

	// Link entries that are in sharedMods but not in instance mods.
	let instanceModsEntries = new Set(await fs.readdir(instance.path("mods")));
	for (let entry of await fs.readdir(sharedMods, { withFileTypes: true })) {
		if (entry.isFile()) {
			if (['.zip', '.dat'].includes(path.extname(entry.name))) {
				if (!instanceModsEntries.has(entry.name)) {
					logger.log(`linking ${entry.name} from ${sharedMods}`);
					let target = path.join(sharedMods, entry.name);
					let link = instance.path("mods", entry.name);

					if (process.platform !== "win32") {
						await fs.symlink(path.relative(path.dirname(link), target), link);

					// On Windows symlinks require elevated privileges, which is
					// not something we want to have.  For this reason the mods
					// are hard linked instead.  This has the drawback of not
					// being able to identify when mods are removed from the
					// sharedMods directory, or which mods are linked.
					} else {
						await fs.link(target, link);
					}
				}

			} else {
				logger.warning(`Warning: ignoring file '${entry.name}' in sharedMods`);
			}

		} else {
			logger.warning(`Warning: ignoring non-file '${entry.name}' in sharedMods`);
		}
	}
}

async function createInstance(config, args, instance) {
	console.log(`Creating ${instance.path()}`);
	await fs.ensureDir(instance.path());
	await fs.ensureDir(instance.path("script-output"));

	await symlinkMods(instance, "sharedMods", console);
	let instconf = {
		"id": Math.random() * 2 ** 31 | 0,
		"factorioPort": args.port || process.env.FACTORIOPORT || null,
		"clientPort": args["rcon-port"] || process.env.RCONPORT || null,
		"__comment_clientPassword": "This is the rcon password. Will be randomly generated if null.",
		"clientPassword": args["rcon-password"] || null,
		"info": {}
	}
	console.log("Clusterio | Created instance with settings:")
	console.log(instconf);

	// create instance config
	fs.writeFileSync(instance.path("config.json"), JSON.stringify(instconf, null, 4));

	let server = new factorio.FactorioServer(path.join("factorio", "data"), instance.path(), {});
	await server.init();

	let serverSettings = await server.exampleSettings();
	let name = "Clusterio instance: " + instance.name;
	if (config.username) {
		name = config.username + "'s clusterio " + instance.name;
	}

	let overrides = {
		"name": name,
		"description": config.description,
		"tags": ["clusterio"],
		"max_players": "20",
		"visibility": config.visibility,
		"username": config.username,
		"token": config.token,
		"game_password": config.game_password,
		"require_user_verification": config.verify_user_identity,
		"allow_commands": config.allow_commands,
		"autosave_interval": 10,
		"autosave_slots": 5,
		"afk_autokick_interval": 0,
		"auto_pause": config.auto_pause,
	};

	for (let [name, value] of Object.entries(overrides)) {
		if (!Object.hasOwnProperty.call(serverSettings, name)) {
			throw Error(`Expected server settings to have a ${name} property`);
		}
		serverSettings[name] = value;
	}

	await fs.writeFile(instance.path("server-settings.json"), JSON.stringify(serverSettings, null, 4));
	console.log("Server settings: ", serverSettings);
	console.log("Creating save .....");

	server.on('output', function(output) {
		console.log("Fact: " + output.message);
	});

	await server.create("world");
	console.log("Clusterio | Successfully created instance");
}

async function startInstance(config, args, instance) {
	var instanceconfig = JSON.parse(await fs.readFile(instance.path("config.json")));
	if (typeof instanceconfig.id !== "number" || isNaN(instanceconfig.id)) {
		throw new Error(`${instance.path("config.json")} is missing id`);
	}
	// Temporary measure for backwards compatibility
	instanceconfig.unique = instanceconfig.id;

	if (process.env.FACTORIOPORT) {
		instanceconfig.factorioPort = process.env.FACTORIOPORT;
	}
	if (process.env.RCONPORT) {
		instanceconfig.rconPort = process.env.RCONPORT;
	}
	console.log("Deleting .tmp.zip files");
	let savefiles = fs.readdirSync(instance.path("saves"));
	for(i = 0; i < savefiles.length; i++){
		if(savefiles[i].substr(savefiles[i].length - 8, 8) == ".tmp.zip") {
			fs.unlinkSync(instance.path("saves", savefiles[i]));
		}
	}
	console.log("Clusterio | Rotating old logs...");
	// clean old log file to avoid crash
	try{
		let logPath = instance.path("factorio-current.log");
		let stat = await fs.stat(logPath);
		console.log(stat)
		console.log(stat.isFile())
		if(stat.isFile()){
			let logFilename = `factorio-${Math.floor(Date.parse(stat.mtime)/1000)}.log`;
			await fs.rename(logPath, instance.path(logFilename));
			console.log(`Log rotated as ${logFilename}`);
		}
	}catch(e){}

	await symlinkMods(instance, "sharedMods", console);

	// Spawn factorio server
	let latestSave = await fileOps.getNewestFile(instance.path("saves"));
	if (latestSave === null) {
		throw new Error(
			"Your savefile seems to be missing. This might because you created an\n"+
			"instance without having factorio installed and configured properly.\n"+
			"Try installing factorio and adding your savefile to\n"+
			"instances/[instancename]/saves/"
		);
	}

	// Patch save with lua modules from plugins
	console.log("Clusterio | Patching save");

	// For now it's assumed that all files in the lua folder of a plugin is
	// to be patched in under the name of the plugin and loaded for all
	// plugins that are not disabled.  This will most likely change in the
	// future when the plugin refactor is done.
	let modules = [];
	for (let pluginName of await fs.readdir("sharedPlugins")) {
		let pluginDir = path.join("sharedPlugins", pluginName);
		if (await fs.pathExists(path.join(pluginDir, "DISABLED"))) {
			continue;
		}

		if (!await fs.pathExists(path.join(pluginDir, "lua"))) {
			continue;
		}

		let module = {
			"name": pluginName,
			"files": [],
		};

		for (let fileName of await fs.readdir(path.join(pluginDir, "lua"))) {
			module["files"].push({
				path: pluginName+"/"+fileName,
				content: await fs.readFile(path.join(pluginDir, "lua", fileName)),
				load: true,
			});
		}

		modules.push(module);
	}
	await factorio.patch(instance.path("saves", latestSave), modules);

	let options = {
		gamePort: args.port || Number(process.env.FACTORIOPORT) || instanceconfig.factorioPort,
		rconPort: args["rcon-port"] || Number(process.env.RCONPORT) || instanceconfig.clientPort,
		rconPassword: args["rcon-password"] || instanceconfig.clientPassword,
	};

	let server = new factorio.FactorioServer(path.join("factorio", "data"), instance.path(), options);
	await server.init();

	// FactorioServer.init may have generated a random port or password
	// if they were null.
	instanceconfig.factorioPort = server.gamePort
	instanceconfig.clientPort = server.rconPort
	instanceconfig.clientPassword = server.rconPassword

	server.on('output', function(output) {
		console.log("Fact: " + output.message);
	});

	server.on('rcon-ready', function() {
		console.log("Clusterio | RCON connection established");
		instanceManagement(config, instance, instanceconfig, server); // XXX async function
	});

	let secondSigint = false
	process.on('SIGINT', () => {
		if (secondSigint) {
			console.log("Caught second interrupt, terminating immediately");
			process.exit(1);
		}

		secondSigint = true;
		console.log("Caught interrupt signal, shutting down");
		server.stop().then(() => {
			// There's currently no shutdown mechanism for instance plugins so
			// they keep the event loop alive.
			process.exit();
		});
	});

	await server.start(latestSave);
}

async function startClient() {
	// argument parsing
	const args = require('minimist')(process.argv.slice(2));

	const command = process.argv[2];

	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

	console.log(`Requiring config from ${args.config || './config'}`);
	const config = require(args.config || './config');

	await fs.ensureDir(config.instanceDirectory);
	await fs.ensureDir("sharedPlugins");
	await fs.ensureDir("sharedMods");

	let instance;
	if (process.argv[3] !== undefined) {
		let name = process.argv[3];
		try {
			checkFilename(name);
		} catch (err) {
			throw new Error(`Instance name ${err.message}`);
		}
		let dir = path.join(config.instanceDirectory, name);
		instance = new Instance(dir, name);
	}

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	if (instance) {
		process.title = "clusterioClient "+instance.name;
	}


	// make sure we have the master access token (can't write to master without it since clusterio 2.0)
	if(!config.masterAuthToken || typeof config.masterAuthToken !== "string"){
		console.error("ERROR invalid config!");
		console.error(
			"Master server now needs an access token for write operations. As clusterio\n"+
			"slaves depends upon this, please add your token to config.json in the field\n"+
			"named masterAuthToken.  You can retrieve your auth token from the master in\n"+
			"secret-api-token.txt after running it once."
		);
		process.exitCode = 1;
		return;
	}

	// handle commandline parameters
	if (!command || command == "help" || command == "--help") {
		printUsage();
		process.exit(1);
	} else if (command == "list") {
		await listInstances(config);
		process.exit(0);
	} else if (command == "manage"){
		await manage(config, instance);
		// process.exit(0);
	} else if (command == "delete") {
		await deleteInstance(instance);
	} else if (command == "download") {
		await downloadMod();
	} else if (command == "start" && instance === undefined) {
		console.error("ERROR: No instanceName provided!");
		console.error("Usage: node client start [instanceName]");
		process.exit(0);
	} else if (command == "start" && !fs.existsSync(instance.path())) {
		await createInstance(config, args, instance);
	} else if (command == "start" && fs.existsSync(instance.path())) {
		await startInstance(config, args, instance);
	} else {
		console.error("Invalid arguments, quitting.");
		process.exit(1);
	}
}

// ensure instancemanagement only ever runs once
var _instanceInitialized;
async function instanceManagement(config, instance, instanceconfig, server) {
	if (_instanceInitialized) return;
	_instanceInitialized = true;

    console.log("Started instanceManagement();");

    /* Open websocket connection to master */
	var socket = ioClient(config.masterURL+"?token="+config.masterAuthToken);
	socket.on("error", err => {
		console.log("SOCKET | Error: ", err);
	});
	socket.on("hello", data => {
		console.log("SOCKET | registering slave!");
		socket.emit("registerSlave", {
			instanceID: instanceconfig.unique,
		});
	});
	setInterval(B=> socket.emit("heartbeat"), 10000);

	// load plugins and execute onLoad event
	let pluginsToLoad = await pluginManager.getPlugins();
	let plugins = [];
	
	for(let i = 0; i < pluginsToLoad.length; i++){
		let pluginLoadStarted = Date.now();
		let combinedConfig = deepmerge(instanceconfig,config,{clone:true});
		combinedConfig.instanceName = instance.name;
		let pluginConfig = pluginsToLoad[i];
		
		if(!global.subscribedFiles) {
			global.subscribedFiles = {};
		}
		if(pluginConfig.binary == "nodePackage" && pluginConfig.enabled){
			// require plugin class and execute it
			let pluginClass = require(path.resolve(pluginConfig.pluginPath, "index"));
			plugins[i] = new pluginClass(combinedConfig, async function(data, callback){
				if(data && data.toString('utf8')[0] != "/") {
                    console.log("Clusterio | "+ pluginsToLoad[i].name + " | " + data.toString('utf8'));
					return true;
				} else if (data && data.toString('utf8')[0] == "/"){
					let result = await server.sendRcon(data.toString('utf8'));
					if (typeof callback === "function") {
						callback(result);
					}
					return result;
				}
			}, { // extra functions to pass in object. Should have done it like this from the start, but won't break backwards compat.
				socket, // socket.io connection to master (and ES6 destructuring, yay)
			});
			if(plugins[i].factorioOutput && typeof plugins[i].factorioOutput === "function"){
				// when factorio logs a line, send it to the plugin. This includes things like autosaves, chat, errors etc
				server.on('stdout', data => plugins[i].factorioOutput(data.toString()));
			}
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string"){
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginConfig.name + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				let outputPath = instance.path(
					"script-output",
					pluginConfig.scriptOutputFileSubscription
				);
				if (!fs.existsSync(outputPath)) {
					// Do something
					fs.writeFileSync(outputPath, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				console.log("Clusterio | Registered file subscription on "+outputPath);
				

				if(!pluginConfig.fileReadDelay || pluginConfig.fileReadDelay == 0) {
					// only wipe the file on restart for now, should most likely be rotated during runtime too
                    fs.writeFileSync(outputPath, "");
                    let tail = new Tail(outputPath);
                    tail.on("line", function (data) {
                        plugins[i].scriptOutput(data);
                    });
                } else {
                    fs.watch(outputPath, fileChangeHandler);
                    // run once in case a plugin wrote out information before the plugin loaded fully
                    // delay, so the socket got enough time to connect
                    setTimeout(() => {
                        fileChangeHandler(false, pluginConfig.scriptOutputFileSubscription);
                    }, 500);

                    // send file contents to plugin for processing
                    function fileChangeHandler(eventType, filename) {
                        if (filename != null) {
                            setTimeout(
                                () => {
                                    // get array of lines in file
                                    let stuff = fs.readFileSync(instance.path("script-output", filename), "utf8").split("\n");

                                    // if you found anything, reset the file
                                    if (stuff[0]) {
                                        fs.writeFileSync(instance.path("script-output", filename), "");
                                    }
                                    for (let o = 0; o < stuff.length; o++) {
                                        if (stuff[o] && !stuff[o].includes('\u0000\u0000')) {
                                            try {
                                                plugins[i].scriptOutput(stuff[o]);
                                            } catch (e) {
                                                console.error(e)
                                            }
                                        }
                                    }
                                },
                                pluginConfig.fileReadDelay || 0
                            );
                        }
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
			server.sendRcon("/silent-command rcon.print(#game.connected_players)").then((playerCount) => {
				var payload = {
					time: Date.now(),
					rconPort: instanceconfig.clientPort,
					rconPassword: instanceconfig.clientPassword,
					serverPort: instanceconfig.factorioPort,
					unique: instanceconfig.unique,
					publicIP: config.publicIP, // IP of the server should be global for all instances, so we pull that straight from the config
					mods:modHashes,
					instanceName: instance.name,
					info: instanceconfig.info,
				};
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
					// console.log("Registered our presence with master "+config.masterURL+" at " + payload.time);
					needle.post(config.masterURL + '/api/getID', payload, needleOptionsWithTokenAuthHeader(config), function (err, response, body) {
						if (err && err.code != "ECONNRESET"){
                            console.error("We got problems, something went wrong when contacting master "+config.masterURL+" at " + payload.time);
							console.error(err);
						} else if (response && response.body) {
							// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
							if(response.body !== "ok") {
                                console.log("Got no \"ok\" while registering our precense with master "+config.masterURL+" at " + payload.time);
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
			};
			needle.post(config.masterURL + '/api/checkMod', payload, needleOptionsWithTokenAuthHeader(config), function (err, response, body) {
				if(err) console.error("Unable to contact master server /api/checkMod! Please check your config.json.");
				if(response && body && body == "found") {
					console.log("master has mod "+modHashes[i].modName);
				} else if (response && body && typeof body == "string") {
					let mod = response.body;
					if(config.uploadModsToMaster){
						console.log("Sending mod: " + mod);
						// Send mods master says it wants
						// response.body is a string which is a modName.zip
						var req = request.post({url: config.masterURL + '/api/uploadMod',
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
						form.append('file', fs.createReadStream(instance.path("mods", mod)));
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
function hashMods(instance, callback) {
	if(!callback) {
		throw new Error("ERROR in function hashMods NO CALLBACK");
	}

	function hashMod(name) {
		if (path.extname(name) != ".zip") {
			// Can't hash unzipped mods, return null that's filtered out later
			return null;
		} else {
			return hashFile(instance.path("mods", name)).then(hash => (
				{modName: name, hash: hash}
			));
		}
	}

	let promises = fs.readdirSync(instance.path("mods")).map(hashMod);
	Promise.all(promises).then(hashes => {
		// Remove null entries from hashMod
		callback(hashes.filter(entry => entry !== null));
	});
}

module.exports = {
	// For testing only
	_Instance: Instance,
	_checkFilename: checkFilename,
	_symlinkMods: symlinkMods,
};

if (module === require.main) {
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startClient().catch(err => {
		console.error(`
+---------------------------------------------------------------+
| Unexpected error occured while starting client, please report |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+`
		);

		console.error(err);
		process.exit(1);
	});
}
