#!/usr/bin/env node

/**
 * Clusterio slave
 *
 * Connects to the master server and hosts Factorio servers that can
 * communicate with the cluster.  It is remotely controlled by {@link
 * module:master/master}.
 *
 * @module slave/slave
 * @author Danielv123, Hornwitser
 * @example
 * npx clusterioslave run
 */
"use strict";
const fs = require("fs-extra");
const path = require("path");
const yargs = require("yargs");
const events = require("events");
const pidusage = require("pidusage");
const setBlocking = require("set-blocking");
const phin = require("phin");
const util = require("util");
const version = require("./package").version;
const winston = require("winston");

// internal libraries
const libFileOps = require("@clusterio/lib/file_ops");
const libFactorio = require("@clusterio/lib/factorio");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libErrors = require("@clusterio/lib/errors");
const libPrometheus = require("@clusterio/lib/prometheus");
const libLuaTools = require("@clusterio/lib/lua_tools");
const libConfig = require("@clusterio/lib/config");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");


const instanceRconCommandDuration = new libPrometheus.Histogram(
	"clusterio_instance_rcon_command_duration_seconds",
	"Histogram of the RCON command duration from request to response.",
	{ labels: ["instance_id"] }
);

const instanceRconCommandSize = new libPrometheus.Histogram(
	"clusterio_instance_rcon_command_size_bytes",
	"Histogram of the RCON command sizes that are sent.",
	{
		labels: ["instance_id", "plugin"],
		buckets: libPrometheus.Histogram.exponential(16, 2, 12),
	}
);

const instanceFactorioCpuTime = new libPrometheus.Gauge(
	"clusterio_instance_factorio_cpu_time_total",
	"Factorio CPU time spent in seconds.",
	{ labels: ["instance_id"] }
);

const instanceFactorioMemoryUsage = new libPrometheus.Gauge(
	"clusterio_instance_factorio_resident_memory_bytes",
	"Factorio resident memory size in bytes.",
	{ labels: ["instance_id"] }
);

const instanceFactorioAutosaveSize = new libPrometheus.Gauge(
	"clusterio_instance_factorio_autosave_bytes",
	"Size of Factorio server autosave in bytes.",
	{ labels: ["instance_id"] }
);

function applyAsConfig(name) {
	return async function action(instance, value) {
		if (name === "tags" && value instanceof Array) {
			// Replace spaces with non-break spaces and delimit by spaces.
			// This does change the defined tags, but there doesn't seem to
			// be a way to include a space into a tag from the console.
			value = value.map(tag => tag.replace(/ /g, "\u00a0")).join(" ");
		}
		try {
			await instance.sendRcon(`/config set ${name} ${value}`);
		} catch (err) {
			logger.error(`Error applying server setting ${name} ${err.message}`);
		}
	};
}

const serverSettingsActions = {
	"afk_autokick_interval": applyAsConfig("afk-auto-kick"),
	"allow_commands": applyAsConfig("allow-commands"),
	"autosave_interval": applyAsConfig("autosave-interval"),
	"autosave_only_on_server": applyAsConfig("autosave-only-on-server"),
	"description": applyAsConfig("description"),
	"ignore_player_limit_for_returning_players": applyAsConfig("ignore-player-limit-for-returning-players"),
	"max_players": applyAsConfig("max-players"),
	"max_upload_slots": applyAsConfig("max-upload-slots"),
	"max_upload_in_kilobytes_per_second": applyAsConfig("max-upload-speed"),
	"name": applyAsConfig("name"),
	"only_admins_can_pause_the_game": applyAsConfig("only-admins-can-pause"),
	"game_password": applyAsConfig("password"),
	"require_user_verification": applyAsConfig("require-user-verification"),
	"tags": applyAsConfig("tags"),
	"visibility": async (instance, value) => {
		for (let scope of ["lan", "public", "steam"]) {
			try {
				let enabled = Boolean(value[scope]);
				await instance.sendRcon(`/config set visibility-${scope} ${enabled}`);
			} catch (err) {
				logger.error(`Error applying visibility ${scope} ${err}`);
			}
		}
	},
};

/**
 * Keeps track of the runtime parameters of an instance
 */
class Instance extends libLink.Link {
	constructor(slave, connector, dir, factorioDir, instanceConfig) {
		super("instance", "slave", connector);
		libLink.attachAllMessages(this);
		this._slave = slave;
		this._dir = dir;

		this.plugins = new Map();
		this.config = instanceConfig;

		/**
		 * ID of this instance, equivalenet to `instance.config.get("instance.id")`.
		 * @constant {number}
		 */
		this.id = this.config.get("instance.id");

		this.logger = logger.child({
			instance_id: this.id,
			instance_name: this.name,
		});

		this._configFieldChanged = (group, field, prev) => {
			let hook = () => libPlugin.invokeHook(this.plugins, "onInstanceConfigFieldChanged", group, field, prev);

			if (group.name === "factorio" && field === "settings") {
				this.updateFactorioSettings(group.get(field), prev).finally(hook);
			} else if (group.name === "factorio" && field === "enable_whitelist") {
				this.updateFactorioWhitelist(group.get(field)).finally(hook);
			} else {
				if (group.name === "factorio" && field === "max_concurrent_commands") {
					this.server.maxConcurrentCommands = group.get(field);
				}
				hook();
			}
		};
		this.config.on("fieldChanged", this._configFieldChanged);

		let serverOptions = {
			logger: this.logger,
			version: this.config.get("factorio.version"),
			gamePort: this.config.get("factorio.game_port"),
			rconPort: this.config.get("factorio.rcon_port"),
			rconPassword: this.config.get("factorio.rcon_password"),
			enableWhitelist: this.config.get("factorio.enable_whitelist"),
			verboseLogging: this.config.get("factorio.verbose_logging"),
			stripPaths: this.config.get("factorio.strip_paths"),
			maxConcurrentCommands: this.config.get("factorio.max_concurrent_commands"),
		};

		this._status = "stopped";
		this._running = false;
		this.server = new libFactorio.FactorioServer(
			factorioDir, this._dir, serverOptions
		);

		this.server.on("output", (parsed, line) => {
			this.logger.log("server", { message: line, instance_id: this.id, parsed });

			libPlugin.invokeHook(this.plugins, "onOutput", parsed, line);
		});

		this.server.on("error", err => {
			this.logger.error(`Error in instance ${this.name}:\n${err.stack}`);
		});

		this.server.on("autosave-finished", name => {
			this._autosave(name).catch(err => {
				this.logger.error(`Error handling autosave-finished in instance ${this.name}:\n${err.stack}`);
			});
		});

		this.server.on("ipc-player_event", event => {
			libLink.messages.playerEvent.send(this, {
				instance_id: this.id,
				...event,
			});
			libPlugin.invokeHook(this.plugins, "onPlayerEvent", event);
		});
	}

	async sendRcon(message, expectEmpty, plugin = "") {
		let instanceId = String(this.id);
		let observeDuration = instanceRconCommandDuration.labels(instanceId).startTimer();
		try {
			return await this.server.sendRcon(message, expectEmpty);
		} finally {
			observeDuration();
			instanceRconCommandSize.labels(instanceId, plugin).observe(Buffer.byteLength(message, "utf8"));
		}
	}

	async _autosave(name) {
		let stat = await fs.stat(this.path("saves", `${name}.zip`));
		instanceFactorioAutosaveSize.labels(String(this.id)).set(stat.size);
	}

	notifyStatus(status) {
		this._status = status;
		libLink.messages.instanceStatusChanged.send(this, {
			instance_id: this.id, status,
		});
	}

	/**
	 * Current state of the instance
	 *
	 * One of stopped, starting, running, creating_save and exporting_data
	 *
	 * @returns {string} instance status.
	 */
	get status() {
		return this._status;
	}

	notifyExit() {
		this._running = false;
		this.notifyStatus("stopped");

		this.config.off("fieldChanged", this._configFieldChanged);

		// Clear metrics this instance is exporting
		for (let collector of libPrometheus.defaultRegistry.collectors) {
			if (
				collector instanceof libPrometheus.ValueCollector
				&& collector.metric.labels.includes("instance_id")
			) {
				collector.removeAll({ instance_id: String(this.id) });
			}
		}

		// Notify plugins of exit
		for (let pluginInstance of this.plugins.values()) {
			pluginInstance.onExit();
		}
	}

	async _loadPlugin(pluginInfo, slave) {
		let pluginLoadStarted = Date.now();
		let InstancePluginClass = await libPluginLoader.loadInstancePluginClass(pluginInfo);
		let instancePlugin = new InstancePluginClass(pluginInfo, this, slave);
		this.plugins.set(pluginInfo.name, instancePlugin);
		await instancePlugin.init();
		libPlugin.attachPluginMessages(this, instancePlugin);

		this.logger.info(`Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
	}

	async init(pluginInfos) {
		this.notifyStatus("starting");
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

		let plugins = {};
		for (let [name, plugin] of this.plugins) {
			plugins[name] = plugin.info.version;
		}
		libLink.messages.instanceInitialized.send(this, { instance_id: this.id, plugins });
	}

	/**
	 * Resolve the effective Factorio server settings
	 *
	 * Use the example settings as the basis and override it with all the
	 * entries from the given settings object.
	 *
	 * @param {Object} overrides - Server settings to override.
	 * @returns {Object}
	 *     server example settings with the given settings applied over it.
	 */
	async resolveServerSettings(overrides) {
		let serverSettings = await this.server.exampleSettings();

		for (let [key, value] of Object.entries(overrides)) {
			if (!Object.hasOwnProperty.call(serverSettings, key)) {
				this.logger.warn(`Server settings does not have the property '${key}'`);
			}
			serverSettings[key] = value;
		}

		return serverSettings;
	}

	/**
	 * Write the server-settings.json file
	 *
	 * Generate the server-settings.json file from the example file in the
	 * data directory and override any settings configured in the instance's
	 * factorio_settings config entry.
	 */
	async writeServerSettings() {
		let serverSettings = await this.resolveServerSettings(this.config.get("factorio.settings"));
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
	 * @param {String} instanceDir -
	 *     Directory to create the new instance into.
	 * @param {String} factorioDir - Path to factorio installation.
	 */
	static async create(instanceDir, factorioDir) {
		logger.info(`Creating ${instanceDir}`);
		await fs.ensureDir(instanceDir);
		await fs.ensureDir(path.join(instanceDir, "script-output"));
		await fs.ensureDir(path.join(instanceDir, "saves"));
	}

	/**
	 * Prepare instance for starting
	 *
	 * Writes server settings, admin/ban/white-lists and links mods.
	 */
	async prepare() {
		this.logger.verbose("Writing server-settings.json");
		await this.writeServerSettings();

		if (this.config.get("factorio.sync_adminlist")) {
			this.logger.verbose("Writing server-adminlist.json");
			fs.outputFile(
				this.server.writePath("server-adminlist.json"),
				JSON.stringify([...this._slave.adminlist], null, 4)
			);
		}

		if (this.config.get("factorio.sync_banlist")) {
			this.logger.verbose("Writing server-banlist.json");
			fs.outputFile(
				this.server.writePath("server-banlist.json"),
				JSON.stringify([...this._slave.banlist].map(
					([username, reason]) => ({ username, reason })
				), null, 4),
			);
		}

		if (this.config.get("factorio.sync_whitelist")) {
			this.logger.verbose("Writing server-whitelist.json");
			fs.outputFile(
				this.server.writePath("server-whitelist.json"),
				JSON.stringify([...this._slave.whitelist], null, 4)
			);
		}

		this.logger.verbose("Rotating old logs...");
		// clean old log file to avoid crash
		try {
			let logPath = this.path("factorio-current.log");
			let stat = await fs.stat(logPath);
			if (stat.isFile()) {
				let logFilename = `factorio-${Math.floor(Date.parse(stat.mtime)/1000)}.log`;
				await fs.rename(logPath, this.path(logFilename));
				this.logger.verbose(`Log rotated as ${logFilename}`);
			}
		} catch (err) {
			this.logger.error(`Error rotating logs:\n${err.stack}`);
		}

		// eslint-disable-next-line no-use-before-define
		await symlinkMods(this, "sharedMods");
	}

	/**
	 * Prepare a save for starting
	 *
	 * Creates a new save if no save is passed and patches it with modules.
	 *
	 * @param {String|null} saveName -
	 *     Save to prepare from the instance saves directory.  Creates a new
	 *     save if null.
	 * @returns {String} Name of the save prepared.
	 */
	async prepareSave(saveName) {
		// Use latest save if no save was specified
		if (saveName === null) {
			saveName = await libFileOps.getNewestFile(
				this.path("saves"), (name) => !name.endsWith(".tmp.zip")
			);
		}

		// Create save if no save was found.
		if (saveName === null) {
			this.logger.info("Creating new save");
			await this.server.create("world.zip");
			saveName = "world.zip";
		}

		if (!this.config.get("factorio.enable_save_patching")) {
			return saveName;
		}

		// Patch save with lua modules from plugins
		this.logger.verbose("Patching save");

		// Find plugin modules to patch in
		let modules = new Map();
		for (let [pluginName, plugin] of this.plugins) {
			let pluginPackagePath = require.resolve(path.posix.join(plugin.info.requirePath, "package.json"));
			let modulePath = path.join(path.dirname(pluginPackagePath), "module");
			if (!await fs.pathExists(modulePath)) {
				continue;
			}

			let moduleJsonPath = path.join(modulePath, "module.json");
			if (!await fs.pathExists(moduleJsonPath)) {
				throw new Error(`Module for plugin ${pluginName} is missing module.json`);
			}

			let module = JSON.parse(await fs.readFile(moduleJsonPath));
			if (module.name !== pluginName) {
				throw new Error(`Expected name of module for plugin ${pluginName} to match the plugin name`);
			}

			module = {
				version: plugin.info.version,
				dependencies: { "clusterio": "*" },
				path: modulePath,
				load: [],
				require: [],
				...module,
			};
			modules.set(module.name, module);
		}

		// Find stand alone modules to load
		// XXX for now only the included clusterio module is loaded
		for (let entry of await fs.readdir(path.join(__dirname, "modules"), { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (modules.has(entry.name)) {
					throw new Error(`Module with name ${entry.name} already exists in a plugin`);
				}

				let moduleJsonPath = path.join(__dirname, "modules", entry.name, "module.json");
				if (!await fs.pathExists(moduleJsonPath)) {
					throw new Error(`Module ${entry.name} is missing module.json`);
				}

				let module = JSON.parse(await fs.readFile(moduleJsonPath));
				if (module.name !== entry.name) {
					throw new Error(`Expected name of module ${entry.name} to match the directory name`);
				}

				module = {
					path: path.join(__dirname, "modules", entry.name),
					dependencies: { "clusterio": "*" },
					load: [],
					require: [],
					...module,
				};
				modules.set(module.name, module);
			}
		}

		await libFactorio.patch(this.path("saves", saveName), [...modules.values()]);
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
		this.server.on("rcon-ready", () => {
			this.logger.verbose("RCON connection established");
		});

		this.server.on("exit", () => this.notifyExit());
		await this.server.start(saveName);

		if (this.config.get("factorio.enable_save_patching")) {
			await this.server.disableAchievements();
			await this.updateInstanceData();
		}

		await libPlugin.invokeHook(this.plugins, "onStart");

		this._running = true;
		this.notifyStatus("running");
	}

	/**
	 * Start Factorio server by loading a scenario
	 *
	 * Launches the Factorio server for this instance with the given
	 * scenario.
	 *
	 * @param {String} scenario - Name of scenario to load.
	 */
	async startScenario(scenario) {
		this.server.on("rcon-ready", () => {
			this.logger.verbose("RCON connection established");
		});

		this.server.on("exit", () => this.notifyExit());
		await this.server.startScenario(scenario);

		await libPlugin.invokeHook(this.plugins, "onStart");

		this._running = true;
		this.notifyStatus("running");
	}

	/**
	 * Update instance information on the Factorio side
	 */
	async updateInstanceData() {
		let name = libLuaTools.escapeString(this.name);
		await this.sendRcon(`/sc clusterio_private.update_instance(${this.id}, "${name}")`, true);
	}

	async updateFactorioSettings(current, previous) {
		current = await this.resolveServerSettings(current);
		previous = await this.resolveServerSettings(previous);

		for (let [key, action] of Object.entries(serverSettingsActions)) {
			if (current[key] !== undefined && !util.isDeepStrictEqual(current[key], previous[key])) {
				await action(this, current[key]);
			}
		}
	}

	/**
	 * Enable or disable the player whitelist
	 *
	 * @param {boolean} enable -
	 *     True to enable the whitelist, False to disable the whitelist.
	 */
	async updateFactorioWhitelist(enable) {
		if (!enable) {
			await this.sendRcon("/whitelist disable");
		}

		if (this.config.get("factorio.sync_whitelist")) {
			await this.sendRcon("/whitelist clear");
			for (let player of this._slave.whitelist) {
				await this.sendRcon(`/whitelist ${player}`);
			}
		}

		if (enable) {
			await this.sendRcon("/whitelist enable");
		}
	}

	async adminlistUpdateEventHandler(message) {
		if (!this.config.get("factorio.sync_adminlist")) {
			return;
		}

		let { name, admin } = message.data;
		let command = admin ? `/promote ${name}` : `/demote ${name}`;
		await this.sendRcon(command);
	}

	async banlistUpdateEventHandler(message) {
		if (!this.config.get("factorio.sync_banlist")) {
			return;
		}

		let { name, banned, reason } = message.data;
		let command = banned ? `/ban ${name} ${reason}` : `/unban ${name}`;
		await this.sendRcon(command);
	}

	async whitelistUpdateEventHandler(message) {
		if (!this.config.get("factorio.sync_whitelist")) {
			return;
		}

		let { name, whitelisted } = message.data;
		let command = whitelisted ? `/whitelist add ${name}` : `/whiteliste remove ${name}`;
		await this.sendRcon(command);
	}


	/**
	 * Stop the instance
	 */
	async stop() {
		this._running = false;

		// XXX this needs more thought to it
		if (this.server._state === "running") {
			await libPlugin.invokeHook(this.plugins, "onStop");
			await this.server.stop();
		}
	}

	async masterConnectionEventEventHandler(message) {
		await libPlugin.invokeHook(this.plugins, "onMasterConnectionEvent", message.data.event);
	}

	async prepareMasterDisconnectRequestHandler() {
		await libPlugin.invokeHook(this.plugins, "onPrepareMasterDisconnect");
	}

	async getMetricsRequestHandler() {
		let results = [];
		if (this._running) {
			let pluginResults = await libPlugin.invokeHook(this.plugins, "onMetrics");
			for (let metricIterator of pluginResults) {
				for await (let metric of metricIterator) {
					results.push(libPrometheus.serializeResult(metric));
				}
			}
		}

		let pid = this.server.pid;
		if (pid) {
			let stats = await pidusage(pid);
			instanceFactorioCpuTime.labels(String(this.id)).set(stats.ctime / 1000);
			instanceFactorioMemoryUsage.labels(String(this.id)).set(stats.memory);
		}

		return { results };
	}

	async startInstanceRequestHandler(message) {
		let saveName = message.data.save;
		try {
			await this.prepare();
			saveName = await this.prepareSave(saveName);
		} catch (err) {
			this.notifyExit();
			throw err;
		}

		try {
			await this.start(saveName);
		} catch (err) {
			await this.stop();
			throw err;
		}
	}

	async loadScenarioRequestHandler(message) {
		if (this.config.get("factorio.enable_save_patching")) {
			this.notifyExit();
			throw new libErrors.RequestError("Load scenario cannot be used with save patching enabled");
		}

		try {
			await this.prepare();
		} catch (err) {
			this.notifyExit();
			throw err;
		}

		try {
			await this.startScenario(message.data.scenario);
		} catch (err) {
			await this.stop();
			throw err;
		}
	}

	async createSaveRequestHandler() {
		this.notifyStatus("creating_save");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings();

			this.logger.verbose("Creating save .....");
			// eslint-disable-next-line no-use-before-define
			await symlinkMods(this, "sharedMods");

		} catch (err) {
			this.notifyExit();
			throw err;
		}

		this.server.on("exit", () => this.notifyExit());
		await this.server.create("world");
		this.logger.info("Successfully created save");
	}

	async exportDataRequestHandler() {
		this.notifyStatus("exporting_data");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings();

			this.logger.info("Exporting data .....");
			// eslint-disable-next-line no-use-before-define
			await symlinkMods(this, "sharedMods");
			let zip = await libFactorio.exportData(this.server);

			let content = await zip.generateAsync({ type: "nodebuffer" });
			let url = new URL(this._slave.config.get("slave.master_url"));
			url.pathname += "api/upload-export";
			let response = await phin({
				url, method: "PUT",
				data: content,
				core: { ca: this._slave.tlsCa },
				headers: {
					"Content-Type": "application/zip",
					"x-access-token": this._slave.config.get("slave.master_token"),
				},
			});
			if (response.statusCode !== 200) {
				throw Error(`Upload failed: ${response.statusCode} ${response.statusMessage}: ${response.body}`);
			}

		} finally {
			this.notifyExit();
		}
	}

	async stopInstanceRequestHandler() {
		await this.stop();
	}

	async sendRconRequestHandler(message) {
		let result = await this.sendRcon(message.data.command);
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
	 *
	 * @returns {string} path in instance directory.
	 */
	path(...parts) {
		return path.join(this._dir, ...parts);
	}
}

/**
 * Searches for instances in the provided directory
 *
 * Looks through all sub-dirs of the provided directory for valid
 * instance definitions and return a mapping of instance id to
 * instanceInfo objects.
 *
 * @param {string} instancesDir - Directory containing instances
 * @returns {Map<integer, Object>}
 *     mapping between instance id and information about this instance.
 */
async function discoverInstances(instancesDir) {
	let instanceInfos = new Map();
	for (let entry of await fs.readdir(instancesDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			let instanceConfig = new libConfig.InstanceConfig("slave");
			let configPath = path.join(instancesDir, entry.name, "instance.json");

			try {
				await instanceConfig.load(JSON.parse(await fs.readFile(configPath)));

			} catch (err) {
				if (err.code === "ENOENT") {
					continue; // Ignore folders without config.json
				}

				logger.error(`Error occured while parsing ${configPath}: ${err.message}`);
				continue;
			}

			let instancePath = path.join(instancesDir, entry.name);
			logger.verbose(`found instance ${instanceConfig.get("instance.name")} in ${instancePath}`);
			instanceInfos.set(instanceConfig.get("instance.id"), {
				path: instancePath,
				config: instanceConfig,
			});
		}
	}
	return instanceInfos;
}

class InstanceConnection extends libLink.Link {
	constructor(connector, slave, instanceId) {
		super("slave", "instance", connector);
		this.slave = slave;
		this.instanceId = instanceId;
		this.plugins = new Map();
		this.status = "stopped";
		libLink.attachAllMessages(this);

		for (let pluginInfo of slave.pluginInfos) {
			libPlugin.attachPluginMessages(this, { info: pluginInfo });
		}
	}

	async forwardRequestToMaster(message, request) {
		return await request.send(this.slave, message.data);
	}

	async forwardRequestToInstance(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = this.slave.instanceConnections.get(instanceId);
		if (!instanceConnection) {
			// Instance is probably on another slave
			return await this.forwardRequestToMaster(message, request);
		}

		if (request.plugin && !instanceConnection.plugins.has(request.plugin)) {
			throw new libErrors.RequestError(`Instance ID ${instanceId} does not have ${request.plugin} plugin loaded`);
		}

		return await request.send(instanceConnection, message.data);
	}


	async forwardEventToInstance(message, event) {
		let instanceId = message.data.instance_id;
		let instanceConnection = this.slave.instanceConnections.get(instanceId);
		if (!instanceConnection) {
			// Instance is probably on another slave
			await this.forwardEventToMaster(message, event);
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
		this.plugins = new Map(Object.entries(message.data.plugins));
	}

	async instanceStatusChangedEventHandler(message, event) {
		this.status = message.data.status;
		if (this.status === "stopped") {
			this.slave.instanceConnections.delete(this.instanceId);
		}
		this.forwardEventToMaster(message, event);
	}
}

class SlaveConnector extends libLink.WebSocketClientConnector {
	constructor(slaveConfig, tlsCa, pluginInfos) {
		super(
			slaveConfig.get("slave.master_url"),
			slaveConfig.get("slave.reconnect_delay"),
			tlsCa
		);
		this.slaveConfig = slaveConfig;
		this.pluginInfos = pluginInfos;
	}

	register() {
		logger.info("SOCKET | registering slave");
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

function checkFilename(name) {
	// All of these are bad in Windows only, except for /, . and ..
	// See: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
	const badChars = /[<>:"\/\\|?*\x00-\x1f]/g;
	const badEnd = /[. ]$/;

	const oneToNine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
	const badNames = [
		// Relative path components
		".", "..",

		// Reserved filenames in Windows
		"CON", "PRN", "AUX", "NUL",
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
 * Handles running the slave
 *
 * Connects to the master server over the WebSocket and manages intsances.
 */
class Slave extends libLink.Link {
	// I don't like God classes, but the alternative of putting all this state
	// into global variables is not much better.
	constructor(connector, slaveConfig, tlsCa, pluginInfos) {
		super("slave", "master", connector);
		libLink.attachAllMessages(this);

		this.pluginInfos = pluginInfos;
		for (let pluginInfo of pluginInfos) {
			libPlugin.attachPluginMessages(this, { info: pluginInfo });
		}

		this.config = slaveConfig;

		/**
		 * Certificate authority used to validate TLS connections to the master.
		 * @type {?string}
		 */
		this.tlsCa = tlsCa;

		this.instanceConnections = new Map();
		this.discoveredInstanceInfos = new Map();
		this.instanceInfos = new Map();

		this.adminlist = new Set();
		this.banlist = new Map();
		this.whitelist = new Set();

		this.connector.on("hello", data => {
			this.serverVersion = data.version;
			this.serverPlugins = new Map(Object.entries(data.plugins));
		});

		this._startup = true;
		this._disconnecting = false;
		this._shuttingDown = false;

		this.connector.on("connect", () => {
			if (this._shuttingDown) {
				return;
			}

			this.updateInstances().catch((err) => {
				logger.fatal(`Unexpected error updating instances:\n${err.stack}`);
				return this.shutdown();
			});
		});

		this.connector.on("close", () => {
			if (this._shuttingDown) {
				return;
			}

			if (this._disconnecting) {
				this._disconnecting = false;
				this.connector.connect().catch((err) => {
					logger.fatal(`Unexpected error reconnecting to master:\n${err.stack}`);
					return this.shutdown();
				});

			} else {
				logger.fatal("Master connection was unexpectedly closed");
				this.shutdown();
			}
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let instanceConnection of this.instanceConnections.values()) {
					libLink.messages.masterConnectionEvent.send(instanceConnection, { event });
				}
			});
		}
	}

	async _findNewInstanceDir(name) {
		try {
			checkFilename(name);
		} catch (err) {
			throw new Error(`Instance name ${err.message}`);
		}

		// For now add dashes until an unused directory name is found
		let dir = path.join(this.config.get("slave.instances_directory"), name);
		while (await fs.pathExists(dir)) {
			dir += "-";
		}

		return dir;
	}

	async forwardRequestToInstance(message, request) {
		let instanceId = message.data.instance_id;
		if (!this.instanceInfos.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		let instanceConnection = this.instanceConnections.get(instanceId);
		if (!instanceConnection) {
			throw new libErrors.RequestError(`Instance ID ${instanceId} is not running`);
		}

		if (request.plugin && !instanceConnection.plugins.has(request.plugin)) {
			throw new libErrors.RequestError(`Instance ID ${instanceId} does not have ${request.plugin} plugin loaded`);
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

	async syncUserListsEventHandler(message) {
		let updateList = (list, updatedList, prop, event) => {
			let added = new Set(updatedList);
			let removed = new Set(list);
			list.forEach(el => added.delete(el));
			updatedList.forEach(el => removed.delete(el));

			for (let name of added) {
				list.add(name);
				this.broadcastEventToInstance(
					{ data: { name, [prop]: true }}, event
				);
			}

			for (let name of removed) {
				list.delete(name);
				this.broadcastEventToInstance(
					{ data: { name, [prop]: false }}, event
				);
			}
		};

		updateList(this.adminlist, message.data.adminlist, "admin", libLink.messages.adminlistUpdate);
		updateList(this.whitelist, message.data.whitelist, "whitelisted", libLink.messages.whitelistUpdate);

		let addedOrChanged = new Map(message.data.banlist);
		let removed = new Set(this.banlist.keys());
		addedOrChanged.forEach((_, name) => removed.delete(name));
		this.banlist.forEach((reason, name) => {
			if (addedOrChanged.get(name) === reason) {
				addedOrChanged.delete(name);
			}
		});

		for (let [name, reason] of addedOrChanged) {
			this.banlist.set(name, reason);
			this.broadcastEventToInstance(
				{ data: { name, banned: true, reason }}, libLink.messages.banlistUpdate
			);
		}

		for (let name of removed) {
			this.banlist.delete(name);
			this.broadcastEventToInstance(
				{ data: { name, banned: false, reason: "" }}, libLink.messages.banlistUpdate
			);
		}
	}

	async adminlistUpdateEventHandler(message) {
		let { name, admin } = message.data;
		if (admin) {
			this.adminlist.add(name);
		} else {
			this.adminlist.delete(name);
		}
	}

	async banlistUpdateEventHandler(message) {
		let { name, banned, reason } = message.data;
		if (banned) {
			this.banlist.set(name, reason);
		} else {
			this.banlist.delete(name);
		}
	}

	async whitelistUpdateEventHandler(message) {
		let { name, whitelisted } = message.data;
		if (whitelisted) {
			this.whitelist.add(name);
		} else {
			this.whitelist.delete(name);
		}
	}

	async assignInstanceRequestHandler(message) {
		let { instance_id, serialized_config } = message.data;
		let instanceInfo = this.instanceInfos.get(instance_id);
		if (instanceInfo) {
			instanceInfo.config.update(serialized_config, true, "master");
			logger.verbose(`Updated config for ${instanceInfo.path}`);

		} else {
			instanceInfo = this.discoveredInstanceInfos.get(instance_id);
			if (instanceInfo) {
				instanceInfo.config.update(serialized_config, true, "master");

			} else {
				let instanceConfig = new libConfig.InstanceConfig("slave");
				await instanceConfig.load(serialized_config, "master");

				// XXX: race condition on multiple simultanious calls
				let instanceDir = await this._findNewInstanceDir(instanceConfig.get("instance.name"));

				await Instance.create(instanceDir, this.config.get("slave.factorio_directory"));
				instanceInfo = {
					path: instanceDir,
					config: instanceConfig,
				};

				this.discoveredInstanceInfos.set(instance_id, instanceInfo);
			}

			this.instanceInfos.set(instance_id, instanceInfo);
			logger.verbose(`assigned instance ${instanceInfo.config.get("instance.name")}`);
		}

		// Somewhat hacky, but in the event of a lost session the status is
		// resent on assigment since the master server sends an assigment
		// request for all the instances it knows should be on this slave.
		let instanceConnection = this.instanceConnections.get(instance_id);
		libLink.messages.instanceStatusChanged.send(this, {
			instance_id,
			status: instanceConnection ? instanceConnection.status : "stopped",
		});

		// save a copy of the instance config
		let warnedOutput = {
			_warning: "Changes to this file will be overwritten by the master server's copy.",
			...instanceInfo.config.serialize(),
		};
		await fs.outputFile(
			path.join(instanceInfo.path, "instance.json"),
			JSON.stringify(warnedOutput, null, 4)
		);
	}

	async unassignInstanceRequestHandler(message) {
		let instanceId = message.data.instance_id;
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (instanceInfo) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			if (instanceConnection && ["starting", "running"].includes(instanceConnection.status)) {
				await libLink.messages.stopInstance.send(instanceConnection, { instance_id: instanceId });
			}

			this.instanceInfos.delete(instanceId);
			logger.verbose(`unassigned instance ${instanceInfo.config.get("instance.name")}`);
		}
	}

	/**
	 * Initialize and connect an unloaded instance
	 *
	 * @param {number} instanceId - ID of instance to initialize.
	 * @returns {module:slave/slave~InstanceConnection} connection to instance.
	 */
	async _connectInstance(instanceId) {
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		if (this.instanceConnections.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let [connectionClient, connectionServer] = libLink.VirtualConnector.makePair();
		let instanceConnection = new InstanceConnection(connectionServer, this, instanceId);
		let instance = new Instance(
			this, connectionClient, instanceInfo.path, this.config.get("slave.factorio_directory"), instanceInfo.config
		);

		this.instanceConnections.set(instanceId, instanceConnection);
		await instance.init(this.pluginInfos);

		return instanceConnection;
	}

	async getMetricsRequestHandler() {
		let requests = [];
		for (let instanceConnection of this.instanceConnections.values()) {
			requests.push(libLink.messages.getMetrics.send(instanceConnection));
		}

		let results = [];
		for (let response of await Promise.all(requests)) {
			results.push(...response.results);
		}

		for await (let result of libPrometheus.defaultRegistry.collect()) {
			if (result.metric.name.startsWith("process_")) {
				results.push(libPrometheus.serializeResult(result, {
					addLabels: { "slave_id": String(this.config.get("slave.id")) },
					metricName: result.metric.name.replace("process_", "clusterio_slave_"),
				}));

			} else {
				results.push(libPrometheus.serializeResult(result));
			}
		}

		return { results };
	}

	async startInstanceRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = await this._connectInstance(instanceId);
		return await request.send(instanceConnection, message.data);
	}

	async loadScenarioRequestHandler(message, request) {
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
		await libLink.messages.stopInstance.send(instanceConnection, { instance_id: instanceId });
	}

	async deleteInstanceRequestHandler(message) {
		let instanceId = message.data.instance_id;
		if (this.instanceConnections.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let instanceInfo = this.discoveredInstanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}

		this.discoveredInstanceInfos.delete(instanceId);
		this.instanceInfos.delete(instanceId);
		await fs.remove(instanceInfo.path);
	}

	/**
	 * Discover available instances
	 *
	 * Looks through the instances directory for instances and updates
	 * the slave and master server with the new list of instances.
	 */
	async updateInstances() {
		this.discoveredInstanceInfos = await discoverInstances(this.config.get("slave.instances_directory"));
		let list = [];
		for (let [instanceId, instanceInfo] of this.discoveredInstanceInfos) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			list.push({
				serialized_config: instanceInfo.config.serialize("master"),
				status: instanceConnection ? instanceConnection.status : "stopped",
			});
		}
		await libLink.messages.updateInstances.send(this, { instances: list });

		// Handle configured auto startup instances
		if (this._startup) {
			this._startup = false;

			for (let [instanceId, instanceInfo] of this.instanceInfos) {
				if (instanceInfo.config.get("instance.auto_start")) {
					try {
						let instanceConnection = await this._connectInstance(instanceId);
						await libLink.messages.startInstance.send(instanceConnection, {
							instance_id: instanceId,
							save: null,
						});
					} catch (err) {
						logger.error(
							`Error during auto startup for ${instanceInfo.config.get("instance.name")}:\n${err.stack}`
						);
					}
				}
			}
		}
	}

	async prepareDisconnectRequestHandler(message, request) {
		this._disconnecting = true;
		for (let instanceConnection of this.instanceConnections.values()) {
			await libLink.messages.prepareMasterDisconnect.send(instanceConnection);
		}
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	/**
	 * Stops all instances and closes the connection
	 */
	async shutdown() {
		if (this._shuttingDown) {
			return;
		}
		this._shuttingDown = true;
		this.connector.setTimeout(30);

		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				logger.error(`Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		try {
			for (let instanceId of this.instanceConnections.keys()) {
				await this.stopInstance(instanceId);
			}
			await this.connector.close(1001, "Slave Shutdown");

			// Clear silly interval in pidfile library.
			pidusage.clear();
		} catch (err) {
			setBlocking(true);
			logger.error(`
+--------------------------------------------------------------------+
| Unexpected error occured while shutting down slave, please report  |
| it to https://github.com/clusterio/factorioClusterio/issues        |
+--------------------------------------------------------------------+
${err.stack}`
			);
			// eslint-disable-next-line no-process-exit
			process.exit(1);
		}
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
 */
async function symlinkMods(instance, sharedMods) {
	await fs.ensureDir(instance.path("mods"));

	// Remove broken symlinks in instance mods.
	for (let entry of await fs.readdir(instance.path("mods"), { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			if (!await fs.pathExists(instance.path("mods", entry.name))) {
				instance.logger.verbose(`Removing broken symlink ${entry.name}`);
				await fs.unlink(instance.path("mods", entry.name));
			}
		}
	}

	// Link entries that are in sharedMods but not in instance mods.
	let instanceModsEntries = new Set(await fs.readdir(instance.path("mods")));
	for (let entry of await fs.readdir(sharedMods, { withFileTypes: true })) {
		if (entry.isFile()) {
			if ([".zip", ".dat"].includes(path.extname(entry.name))) {
				if (!instanceModsEntries.has(entry.name)) {
					instance.logger.verbose(`linking ${entry.name} from ${sharedMods}`);
					let target = path.join(sharedMods, entry.name);
					let link = instance.path("mods", entry.name);

					/* eslint-disable max-depth */
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
					/* eslint-enable max-depth */
				}

			} else {
				instance.logger.warn(`Warning: ignoring file '${entry.name}' in sharedMods`);
			}

		} else {
			instance.logger.warn(`Warning: ignoring non-file '${entry.name}' in sharedMods`);
		}
	}
}

async function startSlave() {
	// argument parsing
	const args = yargs
		.scriptName("slave")
		.usage("$0 <command> [options]")
		.option("log-level", {
			nargs: 1,
			describe: "Log level to print to stdout",
			default: "info",
			choices: ["none"].concat(Object.keys(levels)),
			type: "string",
		})
		.option("config", {
			nargs: 1,
			describe: "slave config file to use",
			default: "config-slave.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Slave config", libSharedCommands.configCommand)
		.command("run", "Run slave")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	logger.add(new winston.transports.File({
		format: winston.format.combine(
			winston.format.json(),
		),
		filename: "slave.log",
	}));
	if (args.logLevel !== "none") {
		logger.add(new ConsoleTransport({
			level: args.logLevel,
			format: new libLoggingUtils.TerminalFormat(),
		}));
	}

	// add better stack traces on promise rejection
	process.on("unhandledRejection", err => logger.error(`Unhandled rejection:\n${err.stack}`));

	logger.info(`Loading available plugins from ${args.pluginList}`);
	let pluginList = new Map();
	try {
		pluginList = new Map(JSON.parse(await fs.readFile(args.pluginList)));
	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	// If the command is plugin management we don't try to load plugins
	let command = args._[0];
	if (command === "plugin") {
		await libSharedCommands.handlePluginCommand(args, pluginList, args.pluginList);
		return;
	}

	logger.info("Loading Plugin info");
	let pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	logger.info(`Loading config from ${args.config}`);
	let slaveConfig = new libConfig.SlaveConfig("slave");
	try {
		await slaveConfig.load(JSON.parse(await fs.readFile(args.config)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await slaveConfig.init();

		} else {
			throw err;
		}
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(args, slaveConfig, args.config);
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
		logger.fatal("ERROR invalid config!");
		logger.fatal(
			"Master server requires an access token for socket operations. As clusterio\n"+
			"slaves depends upon this, please set your token using the command npx\n"+
			"clusterioslave config set slave.master_token <token>.  You can generate an\n"+
			"auth token using npx clusterioctl generate-slave-token."
		);
		process.exitCode = 1;
		return;
	}

	// make sure url ends with /
	if (!slaveConfig.get("slave.master_url").endsWith("/")) {
		logger.fatal("ERROR invalid config!");
		logger.fatal("slave.master_url must end with '/'");
		process.exitCode = 1;
		return;
	}

	let tlsCa = null;
	let tlsCaPath = slaveConfig.get("slave.tls_ca");
	if (tlsCaPath) {
		tlsCa = await fs.readFile(tlsCaPath);
	}

	let slaveConnector = new SlaveConnector(slaveConfig, tlsCa, pluginInfos);
	let slave = new Slave(slaveConnector, slaveConfig, tlsCa, pluginInfos);

	// Handle interrupts
	let secondSigint = false;
	process.on("SIGINT", () => {
		if (secondSigint) {
			setBlocking(true);
			logger.fatal("Caught second interrupt, terminating immediately");
			// eslint-disable-next-line no-process-exit
			process.exit(1);
		}

		secondSigint = true;
		logger.info("Caught interrupt signal, shutting down");
		slave.shutdown();
	});
	let secondSigterm = false;
	process.on("SIGTERM", () => {
		if (secondSigterm) {
			setBlocking(true);
			logger.fatal("Caught second termination, terminating immediately");
			// eslint-disable-next-line no-process-exit
			process.exit(1);
		}

		secondSigterm = true;
		logger.info("Caught termination signal, shutting down");
		slave.shutdown();
	});
	process.on("SIGHUP", () => {
		logger.info("Terminal closed, shutting down");
		slave.shutdown();
	});

	slaveConnector.once("connect", () => {
		logger.add(new libLoggingUtils.LinkTransport({ link: slave }));
	});

	await slaveConnector.connect();
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
	// eslint-disable-next-line no-console
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startSlave().catch(err => {
		if (err instanceof libErrors.AuthenticationFailed) {
			logger.fatal(err.message);

		} else if (err instanceof libErrors.PluginError) {
			logger.fatal(`
${err.pluginName} plugin threw an unexpected error
during startup, please report it to the plugin author.
------------------------------------------------------
${err.original.stack}`
			);

		} else {
			logger.fatal(`
+--------------------------------------------------------------+
| Unexpected error occured while starting slave, please report |
| it to https://github.com/clusterio/factorioClusterio/issues  |
+--------------------------------------------------------------+
${err.stack}`
			);
		}

		process.exitCode = 1;
	});
}
