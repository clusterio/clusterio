const fs = require('fs-extra');
const path = require('path');
const yargs = require("yargs");
const version = require("./package").version;

// internal libraries
const fileOps = require("lib/fileOps");
const hashFile = require('lib/hash').hashFile;
const factorio = require("lib/factorio");
const link = require("lib/link");
const plugin = require("lib/plugin");
const errors = require("lib/errors");
const prometheus = require('lib/prometheus');


/**
 * Keeps track of the runtime parameters of an instance
 */
class Instance extends link.Link{
	constructor(connector, dir, factorioDir, instanceConfig) {
		super('instance', 'slave', connector);
		link.attachAllMessages(this);
		this._dir = dir;

		this.plugins = new Map();

		// This is expected to change with the config system rewrite
		this.config = {
			id: instanceConfig.id,
			name: instanceConfig.name,
			gamePort: instanceConfig.factorioPort,
			rconPort: instanceConfig.clientPort,
			rconPassword: instanceConfig.clientPassword,
		}

		let serverOptions = {
			gamePort: this.config.gamePort,
			rconPort: this.config.rconPort,
			rconPassword: this.config.rconPassword,
		};

		this.server = new factorio.FactorioServer(
			path.join(factorioDir, "data"), this._dir, serverOptions
		);

		this.server.on('output', (output) => {
			link.messages.instanceOutput.send(this, { instance_id: this.config.id, output })

			for (let [name, plugin] of this.plugins) {
				plugin.onOutput(output).catch(err => {
					console.error(`Plugin ${name} raised error in onOutput:`, err);
				});
			}
		});
	}

	async init(pluginInfos) {
		await this.server.init();

		// load plugins
		for (let pluginInfo of pluginInfos) {
			if (!pluginInfo.enabled || !pluginInfo.instanceEntrypoint) {
				continue;
			}

			// require plugin class and initialize it
			let pluginLoadStarted = Date.now();
			let { InstancePlugin } = require(`./plugins/${pluginInfo.name}/${pluginInfo.instanceEntrypoint}`);
			let instancePlugin = new InstancePlugin(pluginInfo, this);
			await instancePlugin.init();
			this.plugins.set(pluginInfo.name, instancePlugin);
			plugin.attachPluginMessages(this, pluginInfo, instancePlugin);

			console.log(`Clusterio | Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
		}
	}

	/**
	 * Creates a new empty instance directory
	 *
	 * Creates the neccessary files for starting up a new instance into the
	 * provided instance directory.
	 *
	 * @param {Number} id -
	 *     ID of the new instance.  Must be unique to the cluster.
	 * @param {String} instanceDir -
	 *     Directory to create the new instance into.
	 * @param {String} factorioDir - Path to factorio installation.
	 * @param {Object} options - Options for new instance.
	 */
	static async create(id, instanceDir, factorioDir, options) {
		let instanceConfig = {
			id,
			name: options.name,
			factorioPort:  null,
			clientPort:  null,
			clientPassword: null,
		}

		console.log(`Clusterio | Creating ${instanceDir}`);
		await fs.ensureDir(instanceDir);
		await fs.ensureDir(path.join(instanceDir, "script-output"));
		await fs.ensureDir(path.join(instanceDir, "saves"));

		// save instance config
		await fs.outputFile(path.join(instanceDir, "config.json"), JSON.stringify(instanceConfig, null, 4));

		let serverSettings = await factorio.FactorioServer.exampleSettings(path.join(factorioDir, "data"));
		let gameName = "Clusterio instance: " + options.name;
		if (options.username) {
			gameName = options.username + "'s clusterio " + options.name;
		}

		let overrides = {
			"name": gameName,
			"description": options.description,
			"tags": ["clusterio"],
			"visibility": options.visibility,
			"username": options.username,
			"token": options.token,
			"game_password": options.game_password,
			"require_user_verification": options.verify_user_identity,
			"allow_commands": options.allow_commands,
			"auto_pause": options.auto_pause,
		};

		for (let [key, value] of Object.entries(overrides)) {
			if (!Object.hasOwnProperty.call(serverSettings, key)) {
				throw Error(`Expected server settings to have a ${key} property`);
			}
			serverSettings[key] = value;
		}

		await fs.writeFile(
			path.join(instanceDir, "server-settings.json"),
			JSON.stringify(serverSettings, null, 4)
		);
	}

	async start(saveName, slaveConfig, socket) {
		console.log("Clusterio | Rotating old logs...");
		// clean old log file to avoid crash
		try{
			let logPath = this.path("factorio-current.log");
			let stat = await fs.stat(logPath);
			if(stat.isFile()){
				let logFilename = `factorio-${Math.floor(Date.parse(stat.mtime)/1000)}.log`;
				await fs.rename(logPath, this.path(logFilename));
				console.log(`Log rotated as ${logFilename}`);
			}
		}catch(e){}

		await symlinkMods(this, "sharedMods", console);

		// Patch save with lua modules from plugins
		console.log("Clusterio | Patching save");

		// Find plugin modules to patch in
		let modules = new Map();
		for (let pluginName of this.plugins.keys()) {
			let modulePath = path.join('plugins', pluginName, 'module');
			if (!await fs.pathExists(modulePath)) {
				continue;
			}

			let moduleJsonPath = path.join(modulePath, 'module.json');
			if (!await fs.pathExists(moduleJsonPath)) {
				throw new Error(`Module for plugin ${pluginName} is missing module.json`);
			}

			let module = JSON.parse(await fs.readFile(moduleJsonPath));
			if (module.name !== pluginName) {
				throw new Error(`Expected name of module for plugin ${pluginName} to match the plugin name`);
			}

			module = Object.assign({
				path: modulePath,
				load: [],
			}, module);
			modules.set(module.name, module);
		}

		for (let entry of await fs.readdir('modules', { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (modules.has(entry.name)) {
					throw new Error(`Module with name ${entry.name} already exists in a plugin`);
				}

				let moduleJsonPath = path.join('modules', entry.name, 'module.json');
				if (!await fs.pathExists(moduleJsonPath)) {
					throw new Error(`Module ${entry.name} is missing module.json`);
				}

				let module = JSON.parse(await fs.readFile(moduleJsonPath));
				if (module.name !== entry.name) {
					throw new Error(`Expected name of module ${entry.name} to match the directory name`);
				}

				module = Object.assign({
					path: path.join('modules', entry.name),
					load: [],
				}, module);
				modules.set(module.name, module);
			}
		}

		await factorio.patch(this.path("saves", saveName), modules.values());

		this.server.on('rcon-ready', () => {
			console.log("Clusterio | RCON connection established");
			// Temporary measure for backwards compatibility
			let compatConfig = {
				id: this.config.id,
				unique: this.config.id,
				name: this.config.name,

				// FactorioServer.init may have generated a random port or password
				// if they were null.
				factorioPort: this.server.gamePort,
				clientPort: this.server.rconPort,
				clientPassword: this.server.rconPassword,
			}
		});

		await this.server.start(saveName);

		for (let pluginInstance of this.plugins.values()) {
			await pluginInstance.onStart();
		}
	}

	/**
	 * Stop the instance
	 */
	async stop() {
		// XXX this needs more thought to it
		if (this.server._state === "running") {
			for (let pluginInstance of this.plugins.values()) {
				await pluginInstance.onStop();
			}

			await this.server.stop();
		}

		// Clear metrics this instance is exporting
		for (let collector of prometheus.defaultRegistry.collectors) {
			if (
				collector instanceof prometheus.ValueCollector
				&& collector.metric.labels.includes('instance_id')
			) {
				collector.removeAll({ instance_id: String(this.config.id) });
			}
		}
	}

	async getMetricsRequestHandler() {
		let results = []
		for (let pluginInstance of this.plugins.values()) {
			let pluginResults = await pluginInstance.onMetrics();
			if (pluginResults !== undefined) {
				for await (let result of pluginResults) {
					results.push(prometheus.serializeResult(result))
				}
			}
		}

		return { results };
	}

	async startInstanceRequestHandler() {
		// Find save to start
		let latestSave = await fileOps.getNewestFile(
			this.path("saves"), (name) => !name.endsWith('.tmp.zip')
		);
		if (latestSave === null) {
			throw new errors.RequestError(
				"No savefile was found to start the instance with."
			);
		}

		await this.start(latestSave, this.config, this.socket);
	}

	async createSaveRequestHandler() {
		console.log("Creating save .....");

		await this.server.create("world");
		console.log("Clusterio | Successfully created save");
	}

	async stopInstanceRequestHandler() {
		await this.stop();
	}

	async sendRconRequestHandler(message) {
		let result = await this.server.sendRcon(message.data.command);
		return { result };
	}

	/**
	 * Name of the instance
	 *
	 * This should not be used for filesystem paths.  See .path() for that.
	 */
	get name() {
		return this.config.name;
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

/**
 * Searches for instances in the provided directory
 *
 * Looks through all sub-dirs of the provided directory for valid
 * instance definitions and returns a mapping of instance id to
 * instance info objects.
 *
 * @returns {Map<integer, Object>} mapping between instance
 */
async function discoverInstances(instancesDir, logger) {
	let instanceInfos = new Map();
	for (let entry of await fs.readdir(instancesDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			let instanceConfig;
			let configPath = path.join(instancesDir, entry.name, "config.json");
			try {
				instanceConfig = JSON.parse(await fs.readFile(configPath));
			} catch (err) {
				if (err.code === "ENOENT") {
					continue; // Ignore folders without config.json
				}

				logger.error(`Error occured while parsing ${configPath}: ${err}`);
				continue;
			}

			// XXX should probably validate the entire config with a JSON Schema.
			if (typeof instanceConfig.id !== "number" || isNaN(instanceConfig.id)) {
				logger.error(`${configPath} is missing id`);
				continue;
			}

			if (typeof instanceConfig.name !== "string") {
				logger.error(`${configPath} is missing name`);
				continue;
			}

			let instancePath = path.join(instancesDir, entry.name);
			logger.log(`found instance ${instanceConfig.name} in ${instancePath}`);
			instanceInfos.set(instanceConfig.id, {
				path: instancePath,
				config: instanceConfig,
			});
		}
	}

	return instanceInfos;
}

class InstanceConnection extends link.Link {
	constructor(connector, slave) {
		super('slave', 'instance', connector);
		this.slave = slave;
		link.attachAllMessages(this);

		for (let pluginInfo of slave.pluginInfos) {
			plugin.attachPluginMessages(this, pluginInfo, null);
		}
	}

	async forwardEventToInstance(message, event) {
		let instanceId = message.data.instance_id;
		if (!this.slave.instanceInfos.has(instanceId)) {
			// Instance is probably on another slave
			await this.slave.forwardEventToMaster(message, event);
			return;
		}

		let instanceConnection = this.slave.instanceConnections.get(instanceId);
		if (!instanceConnection) { return; }

		event.send(instanceConnection, message.data);
	}

	async forwardEventToMaster(message, event) {
		event.send(this.slave, message.data);
	}

	async broadcastEventToInstance(message, event) {
		for (let instanceConnection of this.slave.instanceConnections.values()) {
			if (instanceConnection === this) {
				continue; // Do not broadcast back to the source
			}

			console.log("Broadcasting event");
			event.send(instanceConnection, message.data);
		}
	}
}

class SlaveConnector extends link.SocketIOClientConnector {
	constructor(slaveConfig) {
		super(slaveConfig.masterURL, slaveConfig.masterAuthToken);

		this.id = slaveConfig.id;
		this.name = slaveConfig.name;
	}

	register() {
		console.log("SOCKET | registering slave");
		this.send('register_slave', {
			agent: 'Clusterio Slave',
			version,
			id: this.id,
			name: this.name,
		});
	}
}

/**
 * Handles running the slave
 *
 * Connects to the master server over the socket.io connection and manages
 * intsances.
 */
class Slave extends link.Link {
	// I don't like God classes, but the alternative of putting all this state
	// into global variables is not much better.
	constructor(connector, slaveConfig, pluginInfos) {
		super('slave', 'master', connector);
		link.attachAllMessages(this);

		this.pluginInfos = pluginInfos;
		for (let pluginInfo of pluginInfos) {
			plugin.attachPluginMessages(this, pluginInfo, null);
		}

		this.config = {
			id: slaveConfig.id,
			name: slaveConfig.name,
			instancesDir: slaveConfig.instanceDirectory,
			factorioDir: slaveConfig.factorioDirectory,
			masterUrl: slaveConfig.masterURL,
			masterToken: slaveConfig.masterAuthToken,
			publicAddress: slaveConfig.publicIP,
		}

		this.instanceConnections = new Map();
		this.instanceInfos = new Map();
	}

	async _findNewInstanceDir(name) {
		try {
			checkFilename(name)
		} catch (err) {
			throw new Error(`Instance name ${err.message}`);
		}

		// For now add dashes until an unused directory name is found
		let dir = path.join(this.config.instancesDir, name);
		while (await fs.pathExists(dir)) {
			dir += '-';
		}

		return dir;
	}

	async forwardRequestToInstance(message, request) {
		let instanceId = message.data.instance_id;
		if (!this.instanceInfos.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		let instanceConnection = this.instanceConnections.get(instanceId);
		if (!instanceConnection) {
			throw new errors.RequestError(`Instance ID ${instanceId} is not active`);
		}

		return await request.send(instanceConnection, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instanceId = message.data.instance_id;
		if (!this.instanceInfos.has(instanceId)) { return; }

		let instanceConnection = this.instanceConnections.get(instanceId);
		if (!instanceConnection) { return; }

		event.send(instanceConnection, message.data);
	}

	async broadcastEventToInstance(message, event) {
		for (let instanceConnection of this.instanceConnections.values()) {
			event.send(instanceConnection, message.data);
		}
	}

	async createInstanceRequestHandler(message) {
		let { id, options } = message.data;
		if (this.instanceInfos.has(id)) {
			throw new Error(`Instance with ID ${id} already exists`);
		}

		// XXX: race condition on multiple simultanious calls
		let instanceDir = await this._findNewInstanceDir(options.name);

		await Instance.create(id, instanceDir, this.config.factorioDir, options);
		await this.updateInstances();
	}

	/**
	 * Initialize and connect an unloaded instance
	 */
	async _connectInstance(instanceId) {
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new errors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		if (this.instanceConnections.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} is active`);
		}

		let [connectionClient, connectionServer] = link.VirtualConnector.makePair();
		let instanceConnection = new InstanceConnection(connectionServer, this);
		let instance = new Instance(
			connectionClient, instanceInfo.path, this.config.factorioDir, instanceInfo.config
		);
		await instance.init(this.pluginInfos);

		// XXX: race condition on multiple simultanious calls
		this.instanceConnections.set(instanceId, instanceConnection);
		return instanceConnection;
	}

	async getMetricsRequestHandler() {
		let requests = [];
		for (let instanceConnection of this.instanceConnections.values()) {
			requests.push(link.messages.getMetrics.send(instanceConnection));
		}

		let results = [];
		for (let response of await Promise.all(requests)) {
			results.push(...response.results);
		}

		for await (let result of prometheus.defaultRegistry.collect()) {
			if (result.metric.name.startsWith('process_')) {
				results.push(prometheus.serializeResult(result, {
					addLabels: { 'slave_id': String(this.config.id) },
					metricName: result.metric.name.replace('process_', 'clusterio_slave_'),
				}));

			} else {
				results.push(prometheus.serializeResult(result));
			}
		}

		return { results };
	}

	async startInstanceRequestHandler(message, request) {
		let instanceConnection = await this._connectInstance(message.data.instance_id);
		return await request.send(instanceConnection, message.data);
	}

	async createSaveRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = await this._connectInstance(instanceId);
		await request.send(instanceConnection, message.data);
		this.instanceConnections.delete(instanceId);
	}

	async stopInstanceRequestHandler(message, request) {
		await this.forwardRequestToInstance(message, request);
		this.instanceConnections.delete(message.data.instance_id);
	}

	async deleteInstanceRequestHandler(message) {
		let instanceId = message.data.instance_id;
		if (this.instanceConnections.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} is active`);
		}

		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new errors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		await fs.remove(instanceInfo.path);
		await this.updateInstances();
	}

	/**
	 * Discover available instances
	 *
	 * Looks through the instances directory for instances and updates
	 * the slave and master server with the new list of instances.
	 */
	async updateInstances() {
		this.instanceInfos = await discoverInstances(this.config.instancesDir, console);
		let list = [];
		for (let instanceInfo of this.instanceInfos.values()) {
			list.push({
				id: instanceInfo.config.id,
				name: instanceInfo.config.name,
			});
		}
		link.messages.updateInstances.send(this, { instances: list });
	}

	async start() {
		await this.updateInstances();
	}

	async stop() {
		for (let instanceConnection of this.instanceConnections.values()) {
			// XXX this neeeds more thought to it
			// await instance.stop();
		}
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

async function startClient() {
	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

	// argument parsing
	const args = yargs
		.scriptName("client")
		.usage("$0 <command> [options]")
		.option('config', {
			nargs: 1,
			describe: "slave config file to use",
			default: 'config-slave.json',
			type: 'string',
		})
		.command('create-config', "Create slave config", (yargs) => {
			yargs.options({
				'name': { describe: "Name of the slave", nargs: 1, type: 'string', demandOption: true },
				'url': { describe: "Master URL", nargs: 1, type: 'string', default: "http://localhost:8080/" },
				'token': { describe: "Master token", nargs: 1, type: 'string', demandOption: true },
				'ip': { describe: "Public facing IP", nargs: 1, type: 'string', default: "localhost" },
				'instances-dir': { describe: "Instances directory", nargs: 1, type: 'string', default: "instances" },
				'factorio-dir': { describe: "Factorio directory", nargs: 1, type: 'string', default: "factorio" },
				'id': {
					describe: "Numeric id of the slave",
					nargs: 1,
					type: 'number',
					default: Math.random() * 2**31 | 0,
					defaultDescription: "random id",
				},
			});
		})
		.command('edit-config', "Edit slave config", (yargs) => {
			yargs.options({
				'name': { describe: "Set name of the slave", nargs: 1, type: 'string' },
				'url': { describe: "Set master URL", nargs: 1, type: 'string' },
				'token': { describe: "Set master token", nargs: 1, type: 'string' },
				'ip': { describe: "Set public facing IP", nargs: 1, type: 'string' },
				'instances-dir': { describe: "Set instances directory", nargs: 1, type: 'string' },
				'factorio-dir': { describe: "Set Factorio directory", nargs: 1, type: 'string' },
				'id': { describe: "Set id of the slave", nargs: 1, type: 'number' },
			});
		})
		.command('show-config', "Show slave config")
		.command('start', "Start slave")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	let command = args._[0];

	if (command === "create-config") {
		await fs.outputFile(args.config, JSON.stringify({
			name: args.name,
			masterURL: args.url,
			masterAuthToken: args.token,
			publicIP: args.ip,
			instanceDirectory: args.instancesDir,
			factorioDirectory: args.factorioDir,
			id: args.id,
		}, null, 4), { flag: 'wx' });
		return;

	} else if (command == "edit-config") {
		let slaveConfig = JSON.parse(await fs.readFile(args.config));
		if ('name' in args) slaveConfig.name = args.name;
		if ('url' in args) slaveConfig.masterURL = args.url;
		if ('token' in args) slaveConfig.masterAuthToken = args.token;
		if ('ip' in args) slaveConfig.publicIP = args.ip;
		if ('instancesDir' in args) slaveConfig.instanceDirectory = args.instancesDir;
		if ('factorioDir' in args) slaveConfig.factorioDirectory = args.factorioDir;
		if ('id' in args) slaveConfig.id = args.id;
		await fs.outputFile(args.config, JSON.stringify(slaveConfig, null, 4));
		return;

	} else if (command == "show-config") {
		let slaveConfig = JSON.parse(await fs.readFile(args.config));
		console.log(slaveConfig);
		return;
	}

	// If we get here the command was start

	// handle commandline parameters
	console.log(`Loading ${args.config}`);
	const slaveConfig = JSON.parse(await fs.readFile(args.config));

	await fs.ensureDir(slaveConfig.instanceDirectory);
	await fs.ensureDir("sharedMods");
	await fs.ensureDir("modules");

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioClient";

	// make sure we have the master access token
	if(!slaveConfig.masterAuthToken || typeof slaveConfig.masterAuthToken !== "string"){
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

	// make sure url ends with /
	if (!slaveConfig.masterURL.endsWith("/")) {
		console.error("ERROR invalid config!");
		console.error("masterURL (set with --url) must end with '/'");
		process.exitCode = 1;
		return;
	}

	let pluginInfos = await plugin.getPluginInfos("plugins");
	let slaveConnector = new SlaveConnector(slaveConfig);
	let slave = new Slave(slaveConnector, slaveConfig, pluginInfos);

	// Handle interrupts
	let secondSigint = false
	process.on('SIGINT', () => {
		if (secondSigint) {
			console.log("Caught second interrupt, terminating immediately");
			process.exit(1);
		}

		secondSigint = true;
		console.log("Caught interrupt signal, shutting down");
		slave.stop().then(() => {
			// There's currently no shutdown mechanism for instance plugins so
			// they keep the event loop alive.
			process.exit();
		});
	});

	await slaveConnector.connect();
	await slave.start();

	/*
	} else if (command == "manage"){
		await manage(config, instance);
		// process.exit(0);
	*/
}

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
	_discoverInstances: discoverInstances,
	_Slave: Slave,
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
