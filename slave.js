/**
 * Clusterio slave
 *
 * Connects to the master server and hosts Factorio servers that can
 * communicate with the cluster.  It is remotely controlled by {@link
 * module:master}.
 *
 * @module
 * @author Danielv123, Hornwitser
 * @example
 * node slave run
 */
const fs = require('fs-extra');
const path = require('path');
const yargs = require("yargs");
const events = require("events");
const pidusage = require("pidusage");
const setBlocking = require("set-blocking");
const phin = require("phin");
const version = require("./package").version;

// internal libraries
const fileOps = require("lib/fileOps");
const hashFile = require('lib/hash').hashFile;
const factorio = require("lib/factorio");
const link = require("lib/link");
const plugin = require("lib/plugin");
const errors = require("lib/errors");
const prometheus = require('lib/prometheus');
const luaTools = require('lib/luaTools');
const config = require('lib/config');


const instanceRconCommandsCounter = new prometheus.Counter(
	"clusterio_instance_rcon_commands_total",
	"How many commands have been sent to the instance",
	{ labels: ["instance_id"] }
);

const instanceFactorioCpuTime = new prometheus.Gauge(
	"clusterio_instance_factorio_cpu_time_total",
	"Factorio CPU time spent in seconds.",
	{ labels: ["instance_id"] }
);

const instanceFactorioMemoryUsage = new prometheus.Gauge(
	"clusterio_instance_factorio_resident_memory_bytes",
	"Factorio resident memory size in bytes.",
	{ labels: ["instance_id"] }
);

const instanceFactorioAutosaveSize = new prometheus.Gauge(
	"clusterio_instance_factorio_autosave_bytes",
	"Size of Factorio server autosave in bytes.",
	{ labels: ["instance_id"] }
);

/**
 * Keeps track of the runtime parameters of an instance
 */
class Instance extends link.Link{
	constructor(slave, connector, dir, factorioDir, instanceConfig) {
		super('instance', 'slave', connector);
		link.attachAllMessages(this);
		this._slave = slave;
		this._dir = dir;

		this.plugins = new Map();
		this.config = instanceConfig;

		this._configFieldChanged = (group, field, prev) => {
			plugin.invokeHook(this.plugins, "onInstanceConfigFieldChanged", group, field, prev);
		};
		this.config.on("fieldChanged", this._configFieldChanged);

		let serverOptions = {
			version: this.config.get("factorio.version"),
			gamePort: this.config.get('factorio.game_port'),
			rconPort: this.config.get('factorio.rcon_port'),
			rconPassword: this.config.get('factorio.rcon_password'),
		};

		this._running = false;
		this.server = new factorio.FactorioServer(
			factorioDir, this._dir, serverOptions
		);

		let originalSendRcon = this.server.sendRcon;
		this.server.sendRcon = (...args) => {
			instanceRconCommandsCounter.labels(String(this.config.get("instance.id"))).inc();
			return originalSendRcon.call(this.server, ...args);
		}

		this.server.on('output', (output) => {
			link.messages.instanceOutput.send(this, { instance_id: this.config.get("instance.id"), output })

			plugin.invokeHook(this.plugins, "onOutput", output);
		});

		this.server.on("error", err => {
			console.log(`Error in instance ${this.name}:`, err);
		});

		this.server.on("autosave-finished", name => {
			this._autosave(name).catch(err => {
				console.error("Error handling autosave-finished:", err);
			});
		});
	}

	async _autosave(name) {
		let stat = await fs.stat(this.path("saves", `${name}.zip`));
		instanceFactorioAutosaveSize.labels(String(this.config.get("instance.id"))).set(stat.size);
	}

	notifyExit() {
		this._running = false;
		link.messages.instanceStopped.send(this, { instance_id: this.config.get("instance.id") });

		this.config.off("fieldChanged", this._configFieldChanged);

		// Clear metrics this instance is exporting
		for (let collector of prometheus.defaultRegistry.collectors) {
			if (
				collector instanceof prometheus.ValueCollector
				&& collector.metric.labels.includes('instance_id')
			) {
				collector.removeAll({ instance_id: String(this.config.get("instance.id")) });
			}
		}

		// Notify plugins of exit
		for (let pluginInstance of this.plugins.values()) {
			pluginInstance.onExit();
		}
	}

	async _loadPlugin(pluginInfo, slave) {
		let pluginLoadStarted = Date.now();
		let { InstancePlugin } = require(`./plugins/${pluginInfo.name}/${pluginInfo.instanceEntrypoint}`);
		let instancePlugin = new InstancePlugin(pluginInfo, this, slave);
		this.plugins.set(pluginInfo.name, instancePlugin);
		await instancePlugin.init();
		plugin.attachPluginMessages(this, pluginInfo, instancePlugin);

		console.log(`Clusterio | Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
	}

	async init(pluginInfos) {
		await this.server.init();

		// load plugins
		for (let pluginInfo of pluginInfos) {
			if (
				!pluginInfo.instanceEntrypoint
				|| !this._slave.serverPlugins.has(pluginInfo.name)
				|| !this.config.group(pluginInfo.name).get("enabled")
			) {
				continue;
			}

			try {
				await this._loadPlugin(pluginInfo, this._slave);
			} catch (err) {
				this.notifyExit();
				throw err;
			}
		}

		let plugins = {}
		for (let [name, plugin] of this.plugins) {
			plugins[name] = plugin.info.version;
		}
		link.messages.instanceInitialized.send(this, { instance_id: this.config.get("instance.id"), plugins });
	}

	/**
	 * Write the server-settings.json file
	 *
	 * Generate the server-settings.json file from the example file in the
	 * data directory and override any settings configured in the instance's
	 * factorio_settings config entry.
	 */
	async writeServerSettings() {
		let serverSettings = await this.server.exampleSettings();
		let overrides = this.config.get('factorio.settings');

		for (let [key, value] of Object.entries(overrides)) {
			if (!Object.hasOwnProperty.call(serverSettings, key)) {
				console.log(`Warning: Server settings does not have the property '${key}'`);
			}
			serverSettings[key] = value;
		}

		await fs.writeFile(
			this.server.writePath("server-settings.json"),
			JSON.stringify(serverSettings, null, 4)
		);
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
	 */
	static async create(instanceConfig, instanceDir, factorioDir) {
		console.log(`Clusterio | Creating ${instanceDir}`);
		await fs.ensureDir(instanceDir);
		await fs.ensureDir(path.join(instanceDir, "script-output"));
		await fs.ensureDir(path.join(instanceDir, "saves"));
	}

	/**
	 * Prepare a save for starting
	 *
	 * Writes server settings, links mods, creates a new save if no save is
	 * passed, and patches it with modules.
	 *
	 * @param {String|null} saveName -
	 *     Save to prepare from the instance saves directory.  Creates a new
	 *     save if null.
	 * @returns {String} Name of the save prepared.
	 */
	async prepare(saveName) {
		console.log("Clusterio | Writing server-settings.json");
		await this.writeServerSettings();

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

		// Use latest save if no save was specified
		if (saveName === null) {
			saveName = await fileOps.getNewestFile(
				this.path("saves"), (name) => !name.endsWith('.tmp.zip')
			);
		}

		// Create save if no save was found.
		if (saveName === null) {
			console.log("Clusterio | Creating new save")
			await this.server.create("world.zip");
			saveName = "world.zip";
		}

		// Patch save with lua modules from plugins
		console.log("Clusterio | Patching save");

		// Find plugin modules to patch in
		let modules = new Map();
		for (let [pluginName, plugin] of this.plugins) {
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
				version: plugin.info.version,
				dependencies: { 'clusterio': '*' },
				path: modulePath,
				load: [],
				require: [],
			}, module);
			modules.set(module.name, module);
		}

		// Find stand alone modules to load
		// XXX for now it's assumed all available modules should be loaded.
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
					dependencies: { 'clusterio': '*' },
					load: [],
					require: [],
				}, module);
				modules.set(module.name, module);
			}
		}

		await factorio.patch(this.path("saves", saveName), [...modules.values()]);
		return saveName;
	}

	/**
	 * Start Factorio server
	 *
	 * Launches the Factorio server for this instance with the given save.
	 *
	 * @param {String} saveName - Name of save game to load.
	 */
	async start(saveName) {
		this.server.on('rcon-ready', () => {
			console.log("Clusterio | RCON connection established");
		});

		this.server.on("exit", () => this.notifyExit());
		await this.server.start(saveName);
		await this.server.disableAchievements()
		await this.updateInstanceData();

		await plugin.invokeHook(this.plugins, "onStart");

		this._running = true;
		link.messages.instanceStarted.send(this, { instance_id: this.config.get("instance.id") });
	}

	/**
	 * Update instance information on the Factorio side
	 */
	async updateInstanceData() {
		let name = luaTools.escapeString(this.config.get("instance.name"));
		let id = this.config.get("instance.id");
		await this.server.sendRcon(`/sc clusterio_private.update_instance(${id}, "${name}")`, true);
	}

	/**
	 * Stop the instance
	 */
	async stop() {
		this._running = false;

		// XXX this needs more thought to it
		if (this.server._state === "running") {
			await plugin.invokeHook(this.plugins, "onStop");
			await this.server.stop();
		}
	}

	async masterConnectionEventEventHandler(message) {
		await plugin.invokeHook(this.plugins, "onMasterConnectionEvent", message.data.event);
	}

	async prepareMasterDisconnectRequestHandler() {
		await plugin.invokeHook(this.plugins, "onPrepareMasterDisconnect");
	}

	async getMetricsRequestHandler() {
		let results = []
		if (this._running) {
			let pluginResults = await plugin.invokeHook(this.plugins, "onMetrics");
			for (let metricIterator of pluginResults) {
				for await (let metric of metricIterator) {
					results.push(prometheus.serializeResult(metric))
				}
			}
		}

		let pid = this.server.pid;
		if (pid) {
			let stats = await pidusage(pid);
			instanceFactorioCpuTime.labels(String(this.config.get("instance.id"))).set(stats.ctime / 1000);
			instanceFactorioMemoryUsage.labels(String(this.config.get("instance.id"))).set(stats.memory);
		}

		return { results };
	}

	async startInstanceRequestHandler(message) {
		let saveName = message.data.save;
		try {
			saveName = await this.prepare(saveName)
		} catch (err) {
			this.notifyExit();
			throw err;
		}

		try {
			await this.start(saveName, this.config, this.socket);
		} catch (err) {
			await this.stop();
			throw err;
		}
	}

	async createSaveRequestHandler() {
		try {
			console.log("Clusterio | Writing server-settings.json");
			await this.writeServerSettings();

			console.log("Creating save .....");
			await symlinkMods(this, "sharedMods", console);

		} catch (err) {
			this.notifyExit();
			throw err;
		}

		this.server.on("exit", () => this.notifyExit());
		await this.server.create("world");
		console.log("Clusterio | Successfully created save");
	}

	async exportDataRequestHandler() {
		try {
			console.log("Clusterio | Writing server-settings.json");
			await this.writeServerSettings();

			console.log("Exporting data .....");
			await symlinkMods(this, "sharedMods", console);
			let zip = await factorio.exportData(this.server);

			let content = await zip.generateAsync({ type: "nodebuffer" });
			let url = new URL(this._slave.config.get("slave.master_url"));
			url.pathname += "api/upload-export";
			let response = await phin({
				url, method: "PUT",
				data: content,
				core: { rejectUnauthorized: false },
				headers: {
					"Content-Type": "application/zip",
					"x-access-token": this._slave.config.get("slave.master_token"),
				},
			});
			if (response.statusCode !== 200) {
				throw Error(`Upload failed: ${response.statusCode} ${response.statusMessage}: ${response.body}`)
			}

		} finally {
			this.notifyExit();
		}
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
		return this.config.get("instance.name");
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
 * instance config objects.
 *
 * @returns {Map<integer, Object>} mapping between instance
 */
async function discoverInstances(instancesDir, logger) {
	let instanceInfos = new Map();
	for (let entry of await fs.readdir(instancesDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			let instanceConfig = new config.InstanceConfig();
			let configPath = path.join(instancesDir, entry.name, "instance.json");

			try {
				await instanceConfig.load(JSON.parse(await fs.readFile(configPath)));

			} catch (err) {
				if (err.code === "ENOENT") {
					continue; // Ignore folders without config.json
				}

				logger.error(`Error occured while parsing ${configPath}: ${err}`);
				continue;
			}

			let instancePath = path.join(instancesDir, entry.name);
			logger.log(`found instance ${instanceConfig.get("instance.name")} in ${instancePath}`);
			instanceInfos.set(instanceConfig.get("instance.id"), {
				path: instancePath,
				config: instanceConfig,
			});
		}
	}

	return instanceInfos;
}

class InstanceConnection extends link.Link {
	constructor(connector, slave, instanceId) {
		super('slave', 'instance', connector);
		this.slave = slave;
		this.instanceId = instanceId;
		this.plugins = new Map();
		this.status = "stopped";
		link.attachAllMessages(this);

		for (let pluginInfo of slave.pluginInfos) {
			plugin.attachPluginMessages(this, pluginInfo, null);
		}
	}

	async forwardRequestToMaster(message, request) {
		return await request.send(this.slave, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instanceId = message.data.instance_id;
		let instanceConnection = this.slave.instanceConnections.get(instanceId);
		if (!instanceConnection) {
			// Instance is probably on another slave
			await this.slave.forwardEventToMaster(message, event);
			return;
		}
		if (event.plugin && !instanceConnection.plugins.has(event.plugin)) { return; }

		event.send(instanceConnection, message.data);
	}

	async forwardEventToMaster(message, event) {
		event.send(this.slave, message.data);
	}

	async broadcastEventToInstance(message, event) {
		for (let instanceConnection of this.slave.instanceConnections.values()) {
			// Do not broadcast back to the source
			if (instanceConnection === this) { continue; }
			if (event.plugin && !instanceConnection.plugins.has(event.plugin)) { continue; }

			event.send(instanceConnection, message.data);
		}
	}

	async instanceInitializedEventHandler(message, event) {
		this.status = "initialized";
		this.plugins = new Map(Object.entries(message.data.plugins));
		this.forwardEventToMaster(message, event);
	}

	async instanceStartedEventHandler(message, event) {
		this.status = "running";
		this.forwardEventToMaster(message, event);
	}

	async instanceStoppedEventHandler(message, event) {
		this.status = "stopped";
		this.slave.instanceConnections.delete(this.instanceId);
		this.forwardEventToMaster(message, event);
	}
}

class SlaveConnector extends link.WebSocketClientConnector {
	constructor(slaveConfig, pluginInfos) {
		super(slaveConfig.get("slave.master_url"), slaveConfig.get("slave.reconnect_delay"));
		this.slaveConfig = slaveConfig;
		this.pluginInfos = pluginInfos;
	}

	register() {
		console.log("SOCKET | registering slave");
		let plugins = {};
		for (let pluginInfo of this.pluginInfos) {
			plugins[pluginInfo.name] = pluginInfo.version;
		}

		this.sendHandshake("register_slave", {
			token: this.slaveConfig.get("slave.master_token"),
			agent: "Clusterio Slave",
			version,
			id: this.slaveConfig.get("slave.id"),
			name: this.slaveConfig.get("slave.name"),
			plugins,
		});
	}
}

/**
 * Handles running the slave
 *
 * Connects to the master server over the WebSocket and manages intsances.
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

		this.config = slaveConfig;

		this.instanceConnections = new Map();
		this.instanceInfos = new Map();

		this.connector.on("hello", data => {
			this.serverVersion = data.version;
			this.serverPlugins = new Map(Object.entries(data.plugins));
		});

		this._disconnecting = false;
		this._shuttingDown = false;

		this.connector.on("connect", () => {
			if (this._shuttingDown) {
				return;
			}

			this.updateInstances().catch((err) => {
				console.error("ERROR: Unexpected error updating instances");
				console.error(err);
				this.shutdown().catch((err) => {
					setBlocking(true);
					console.error("ERROR: Unexpected error during shutdown");
					console.error(err);
					process.exit(1)
				});
			});;
		});

		this.connector.on("close", () => {
			if (this._shuttingDown) {
				return;
			}

			if (this._disconnecting) {
				this._disconnecting = false;
				this.connector.connect().catch((err) => {
					console.error("ERROR: Unexpected error reconnecting to master");
					console.error(err);
					this.shutdown().catch((err) => {
						setBlocking(true);
						console.error("ERROR: Unexpected error during shutdown");
						console.error(err);
						process.exit(1)
					});
				});

			} else {
				console.error("ERROR: Master connection was unexpectedly closed");
				this.shutdown().catch((err) => {
					setBlocking(true);
					console.error("ERROR: Unexpected error during shutdown");
					console.error(err);
					process.exit(1)
				});
			}
		});

		for (let event of ["connect", "drop", "close"]) {
			this.connector.on(event, () => {
				for (let instanceConnection of this.instanceConnections.values()) {
					link.messages.masterConnectionEvent.send(instanceConnection, { event });
				}
			});
		}
	}

	async _findNewInstanceDir(name) {
		try {
			checkFilename(name)
		} catch (err) {
			throw new Error(`Instance name ${err.message}`);
		}

		// For now add dashes until an unused directory name is found
		let dir = path.join(this.config.get("slave.instances_directory"), name);
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
			throw new errors.RequestError(`Instance ID ${instanceId} is not running`);
		}

		if (request.plugin && !instanceConnection.plugins.has(request.plugin)) {
			throw new errors.RequestError(`Instance ID ${instanceId} does not have ${request.plugin} plugin loaded`)
		}

		return await request.send(instanceConnection, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instanceId = message.data.instance_id;
		if (!this.instanceInfos.has(instanceId)) { return; }

		let instanceConnection = this.instanceConnections.get(instanceId);
		if (!instanceConnection) { return; }
		if (event.plugin && !instanceConnection.plugins.has(event.plugin)) { return; }

		event.send(instanceConnection, message.data);
	}

	async broadcastEventToInstance(message, event) {
		for (let instanceConnection of this.instanceConnections.values()) {
			if (event.plugin && !instanceConnection.plugins.has(event.plugin)) { continue; }

			event.send(instanceConnection, message.data);
		}
	}

	async assignInstanceRequestHandler(message) {
		let { instance_id, serialized_config } = message.data;
		let instanceInfo = this.instanceInfos.get(instance_id);
		if (instanceInfo) {
			instanceInfo.config.update(serialized_config, true);
			console.log(`Clusterio | Updated config for ${instanceInfo.path}`);
			// TODO: Notify of update if instance is running

		} else {
			let instanceConfig = new config.InstanceConfig();
			await instanceConfig.load(serialized_config);

			// XXX: race condition on multiple simultanious calls
			let instanceDir = await this._findNewInstanceDir(instanceConfig.get("instance.name"));

			await Instance.create(instanceConfig, instanceDir, this.config.get("slave.factorio_directory"));
			instanceInfo = {
				path: instanceDir,
				config: instanceConfig,
			};
			this.instanceInfos.set(instance_id, instanceInfo);
			console.log(`Clusterio | assigned instance ${instanceConfig.get("instance.name")}`);
		}


		// save a copy of the instance config
		let warnedOutput = Object.assign(
			{ _warning: "Changes to this file will be overwritten by the master server's copy." },
			instanceInfo.config.serialize()
		);
		await fs.outputFile(
			path.join(instanceInfo.path, "instance.json"),
			JSON.stringify(warnedOutput, null, 4)
		);
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
			throw new errors.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let [connectionClient, connectionServer] = link.VirtualConnector.makePair();
		let instanceConnection = new InstanceConnection(connectionServer, this, instanceId);
		let instance = new Instance(
			this, connectionClient, instanceInfo.path, this.config.get("slave.factorio_directory"), instanceInfo.config
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
					addLabels: { 'slave_id': String(this.config.get("slave.id")) },
					metricName: result.metric.name.replace('process_', 'clusterio_slave_'),
				}));

			} else {
				results.push(prometheus.serializeResult(result));
			}
		}

		return { results };
	}

	async startInstanceRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = await this._connectInstance(instanceId);
		return await request.send(instanceConnection, message.data);
	}

	async createSaveRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = await this._connectInstance(instanceId);
		await request.send(instanceConnection, message.data);
	}

	async exportDataRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = await this._connectInstance(instanceId);
		await request.send(instanceConnection, message.data);
	}

	async stopInstance(instanceId) {
		let instanceConnection = this.instanceConnections.get(instanceId);
		await link.messages.stopInstance.send(instanceConnection, { instance_id: instanceId });
	}

	async deleteInstanceRequestHandler(message) {
		let instanceId = message.data.instance_id;
		if (this.instanceConnections.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new errors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		await fs.remove(instanceInfo.path);
		this.instanceInfos.delete(instanceId);
	}

	/**
	 * Discover available instances
	 *
	 * Looks through the instances directory for instances and updates
	 * the slave and master server with the new list of instances.
	 */
	async updateInstances() {
		this.instanceInfos = await discoverInstances(this.config.get("slave.instances_directory"), console);
		let list = [];
		for (let [instanceId, instanceInfo] of this.instanceInfos) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			list.push({
				serialized_config: instanceInfo.config.serialize(),
				status: instanceConnection ? instanceConnection.status : "stopped",
			});
		}
		link.messages.updateInstances.send(this, { instances: list });
	}

	async prepareDisconnectRequestHandler(message, request) {
		this._disconnecting = true;
		for (let instanceConnection of this.instanceConnections.values()) {
			await link.messages.prepareMasterDisconnect.send(instanceConnection);
		}
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	/**
	 * Stops all instances and closes the connection
	 */
	async shutdown() {
		this._shuttingDown = true;
		this.connector.setTimeout(30);

		try {
			await link.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof errors.SessionLost)) {
				console.error("Unexpected error preparing disconnect");
				console.error(err);
			}
		}

		for (let instanceId of this.instanceConnections.keys()) {
			await this.stopInstance(instanceId);
		}
		await this.connector.close(1001, "Slave Shutdown");

		// Clear silly interval in pidfile library.
		pidusage.clear();
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

async function startSlave() {
	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

	// argument parsing
	const args = yargs
		.scriptName("slave")
		.usage("$0 <command> [options]")
		.option('config', {
			nargs: 1,
			describe: "slave config file to use",
			default: 'config-slave.json',
			type: 'string',
		})
		.command("config", "Manage Slave config", config.configCommand)
		.command("run", "Run slave")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	console.log("Loading Plugin info");
	let pluginInfos = await plugin.loadPluginInfos("plugins");
	config.registerPluginConfigGroups(pluginInfos);
	config.finalizeConfigs();

	console.log(`Loading config from ${args.config}`);
	let slaveConfig = new config.SlaveConfig();
	try {
		await slaveConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === 'ENOENT') {
			console.log("Config not found, initializing new config");
			await slaveConfig.init();

		} else {
			throw err;
		}
	}

	let command = args._[0];
	if (command === "config") {
		await config.handleConfigCommand(args, slaveConfig, args.config);
		return;
	}

	// If we get here the command was run

	await fs.ensureDir(slaveConfig.get("slave.instances_directory"));
	await fs.ensureDir("sharedMods");
	await fs.ensureDir("modules");

	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioSlave";

	// make sure we have the master access token
	if (slaveConfig.get("slave.master_token") === "enter token here") {
		console.error("ERROR invalid config!");
		console.error(
			"Master server now needs an access token for write operations. As clusterio\n"+
			"slaves depends upon this, please set your token using the command node slave\n"+
			"config set slave.master_token <token>.  You can retrieve your auth token from\n"+
			"the master in secret-api-token.txt after running it once."
		);
		process.exitCode = 1;
		return;
	}

	// make sure url ends with /
	if (!slaveConfig.get("slave.master_url").endsWith("/")) {
		console.error("ERROR invalid config!");
		console.error("slave.master_url must end with '/'");
		process.exitCode = 1;
		return;
	}

	let slaveConnector = new SlaveConnector(slaveConfig, pluginInfos);
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
		slave.shutdown().catch(err => {
			console.error(`
+---------------------------------------------------------------+
| Unexpected error occured while stopping slave, please report  |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+`
			);
			console.error(err);
			process.exit(1);
		});
	});

	await slaveConnector.connect();

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
	startSlave().catch(err => {
		console.error(`
+--------------------------------------------------------------+
| Unexpected error occured while starting slave, please report |
| it to https://github.com/clusterio/factorioClusterio/issues  |
+--------------------------------------------------------------+`
		);

		console.error(err);
		process.exit(1);
	});
}
