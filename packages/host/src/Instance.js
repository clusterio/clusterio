"use strict";
const fs = require("fs-extra");
const path = require("path");
const pidusage = require("pidusage");
const phin = require("phin");
const util = require("util");

// internal libraries
const lib = require("@clusterio/lib");
const { PlayerStats } = lib;


const instanceRconCommandDuration = new lib.Histogram(
	"clusterio_instance_rcon_command_duration_seconds",
	"Histogram of the RCON command duration from request to response.",
	{ labels: ["instance_id"] }
);

const instanceRconCommandSize = new lib.Histogram(
	"clusterio_instance_rcon_command_size_bytes",
	"Histogram of the RCON command sizes that are sent.",
	{
		labels: ["instance_id", "plugin"],
		buckets: lib.Histogram.exponential(16, 2, 12),
	}
);

const instanceFactorioCpuTime = new lib.Gauge(
	"clusterio_instance_factorio_cpu_time_total",
	"Factorio CPU time spent in seconds.",
	{ labels: ["instance_id"] }
);

const instanceFactorioMemoryUsage = new lib.Gauge(
	"clusterio_instance_factorio_resident_memory_bytes",
	"Factorio resident memory size in bytes.",
	{ labels: ["instance_id"] }
);

const instanceFactorioAutosaveSize = new lib.Gauge(
	"clusterio_instance_factorio_autosave_bytes",
	"Size of Factorio server autosave in bytes.",
	{ labels: ["instance_id"] }
);

function applyAsConfig(name) {
	return async function action(instance, value, logger) {
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
	"visibility": async (instance, value, logger) => {
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
 * @alias module:host/src/Instance
 */
class Instance extends lib.Link {
	constructor(host, connector, dir, factorioDir, instanceConfig) {
		super(connector);
		this._host = host;
		this._dir = dir;

		this.plugins = new Map();
		this.config = instanceConfig;

		/**
		 * ID of this instance, equivalenet to `instance.config.get("instance.id")`.
		 * @constant {number}
		 */
		this.id = this.config.get("instance.id");

		this.logger = lib.logger.child({
			instance_id: this.id,
			instance_name: this.name,
		});

		this._configFieldChanged = (group, field, prev) => {
			let hook = () => lib.invokeHook(this.plugins, "onInstanceConfigFieldChanged", group, field, prev);

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
			enableAuthserverBans: this.config.get("factorio.enable_authserver_bans"),
			verboseLogging: this.config.get("factorio.verbose_logging"),
			stripPaths: this.config.get("factorio.strip_paths"),
			maxConcurrentCommands: this.config.get("factorio.max_concurrent_commands"),
		};

		// Valid statuses are stopped, starting, running, stopping, creating_save and exporting_data.
		this._status = "stopped";
		this._loadedSave = null;
		this.server = new lib.FactorioServer(
			factorioDir, this._dir, serverOptions
		);

		this.server.on("output", (parsed, line) => {
			this.logger.log("server", { message: line, instance_id: this.id, parsed });

			lib.invokeHook(this.plugins, "onOutput", parsed, line);
		});

		this.server.on("error", err => {
			if (err instanceof lib.EnvironmentError) {
				this.logger.error(err.message);
			} else {
				this.logger.error(`${this.name}:\n${err.stack}`);
			}
		});

		this.server.on("autosave-finished", name => {
			this._autosave(name).catch(err => {
				this.logger.error(`Error handling autosave-finished in instance ${this.name}:\n${err.stack}`);
			});
		});

		this.server.on("save-finished", () => {
			this.sendSaveListUpdate().catch(err => {
				this.logger.error(`Error handling save-finished in instance ${this.name}:\n${err.stack}`);
			});
		});

		this.server.on("ipc-player_event", event => {
			if (event.type === "join") {
				this._recordPlayerJoin(event.name);
			} else if (event.type === "leave") {
				this._recordPlayerLeave(event.name, event.reason);
			}
		});

		/**
		 * Mod pack currently running on this instance
		 * @type {module:lib.ModPack}
		 */
		this.activeModPack = undefined;

		/**
		 * Per player statistics recorded by this instance.
		 * @type {Map<string, module:lib.PlayerStats>}
		 */
		this.playerStats = new Map();

		/**
		 * Players currently online on the instance.
		 * @type {Map<string, string>}
		 */
		this.playersOnline = new Set();
		this._playerCheckInterval = null;
		this._hadPlayersOnline = false;
		this._playerAutosaveSlot = 1;

		this.handle(lib.InstanceExtractPlayersRequest, this.handleInstanceExtractPlayersRequest.bind(this));
		this.handle(lib.InstanceAdminlistUpdateEvent, this.handleInstanceAdminlistUpdateEvent.bind(this));
		this.handle(lib.InstanceBanlistUpdateEvent, this.handleInstanceBanlistUpdateEvent.bind(this));
		this.handle(lib.InstanceWhitelistUpdateEvent, this.handleInstanceWhitelistUpdateEvent.bind(this));
		this.handle(lib.ControllerConnectionEvent, this.handleControllerConnectionEvent.bind(this));
		this.handle(
			lib.PrepareControllerDisconnectRequest, this.handlePrepareControllerDisconnectRequest.bind(this)
		);
		this.handle(lib.InstanceMetricsRequest, this.handleInstanceMetricsRequest.bind(this));
		this.handle(lib.InstanceStartRequest, this.handleInstanceStartRequest.bind(this));
		this.handle(lib.InstanceLoadScenarioRequest, this.handleInstanceLoadScenarioRequest.bind(this));
		this.handle(lib.InstanceListSavesRequest, this.handleInstanceListSavesRequest.bind(this));
		this.handle(lib.InstanceCreateSaveRequest, this.handleInstanceCreateSaveRequest.bind(this));
		this.handle(lib.InstanceExportDataRequest, this.handleInstanceExportDataRequest.bind(this));
		this.handle(lib.InstanceStopRequest, this.handleInstanceStopRequest.bind(this));
		this.handle(lib.InstanceKillRequest, this.handleInstanceKillRequest.bind(this));
		this.handle(lib.InstanceSendRconRequest, this.handleInstanceSendRconRequest.bind(this));
	}

	_watchPlayerJoinsByChat() {
		this.server.on("output", (parsed, line) => {
			if (parsed.type !== "action") {
				return;
			}

			let name = /^([^ ]+)/.exec(parsed.message)[1];
			if (parsed.action === "JOIN") {
				this._recordPlayerJoin(name);
			} else if (["LEAVE", "KICK", "BAN"].includes(parsed.action)) {
				let reason = {
					"LEAVE": "quit",
					"KICK": "kicked",
					"BAN": "banned",
				}[parsed.action];
				this._recordPlayerLeave(name, reason);
			}
		});

		// Leave log entries are unreliable and sometimes don't show up.
		this._playerCheckInterval = setInterval(() => {
			this._checkOnlinePlayers().catch(err => {
				this.logger.error(`Error checking online players:\n${err.stack}`);
			});
		}, 60e3);
	}

	async _checkOnlinePlayers() {
		if (this.playersOnline.size) {
			let actualPlayers = (await this.sendRcon("/players online"))
				.split("\n")
				.slice(1, -1) // Remove header and trailing newline
				.map(s => s.slice(2, -" (online)".length))
			;
			let left = new Set(this.playersOnline);
			actualPlayers.map(player => left.delete(player));
			let joined = new Set(actualPlayers);
			this.playersOnline.forEach(player => joined.delete(player));

			for (let player of left) {
				this._recordPlayerLeave(player, "quit");
			}

			// Missing join messages is not supposed to happen.
			if (joined.size) {
				this.logger.warn(`Missed join message for ${[...joined].join(", ")}`);
				for (let player of joined) {
					this._recordPlayerJoin(player);
				}
			}
		}
	}

	_recordPlayerJoin(name) {
		if (this.playersOnline.has(name)) {
			return;
		}
		this.playersOnline.add(name);

		let stats = this.playerStats.get(name);
		if (!stats) {
			stats = new PlayerStats();
			this.playerStats.set(name, stats);
		}
		stats.lastJoinAt = new Date();
		stats.joinCount += 1;

		let event = {
			instance_id: this.id,
			type: "join",
			name,
			stats,
		};
		this.sendTo("controller", new lib.InstancePlayerUpdateEvent("join", name, undefined, stats));
		lib.invokeHook(this.plugins, "onPlayerEvent", event);
	}

	_recordPlayerLeave(name, reason) {
		if (!this.playersOnline.delete(name)) {
			return;
		}

		let stats = this.playerStats.get(name);
		stats.lastLeaveAt = new Date();
		stats.lastLeaveReason = reason;
		stats.onlineTimeMs += stats.lastLeaveAt.getTime() - stats.lastJoinAt.getTime();
		this._hadPlayersOnline = true;

		let event = {
			instance_id: this.id,
			type: "leave",
			name,
			reason,
			stats,
		};
		this.sendTo("controller", new lib.InstancePlayerUpdateEvent("leave", name, reason, stats));
		lib.invokeHook(this.plugins, "onPlayerEvent", event);
	}

	async handleInstanceExtractPlayersRequest() {
		const exportPlayerTimes = `/sc
local players = {}
for _, p in pairs(game.players) do
	players[p.name] = p.online_time
end
rcon.print(game.table_to_json(players))`.replace(/\r?\n/g, " ");
		let playerTimes = JSON.parse(await this.sendRcon(exportPlayerTimes));
		let count = 0;

		for (let [name, onlineTimeTicks] of Object.entries(playerTimes)) {
			let stats = this.playerStats.get(name);
			if (!stats) {
				stats = new PlayerStats();
				this.playerStats.set(name, stats);
			}
			stats.onlineTimeMs = onlineTimeTicks * 1000 / 60;

			let event = {
				instance_id: this.id,
				type: "import",
				name,
				stats: stats.toJSON(),
			};
			this.sendTo("controller", new lib.InstancePlayerUpdateEvent("import", name, undefined, stats));
			lib.invokeHook(this.plugins, "onPlayerEvent", event);
			count += 1;
		}
		this.logger.info(`Extracted data for ${count} player(s)`);
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

	static async listSaves(savesDir, loadedSave) {
		let defaultSave = null;
		if (loadedSave === null) {
			defaultSave = await lib.getNewestFile(
				savesDir, (name) => !name.endsWith(".tmp.zip")
			);
		}

		let list = [];
		for (let name of await fs.readdir(savesDir)) {
			let type;
			let stat = await fs.stat(path.join(savesDir, name));
			if (stat.isFile()) {
				type = "file";
			} else if (stat.isDirectory()) {
				type = "directory";
			} else {
				type = "special";
			}

			list.push(new lib.SaveDetails(
				type,
				name,
				stat.size,
				stat.mtimeMs,
				name === loadedSave,
				name === defaultSave,
			));
		}

		return list;
	}

	async sendSaveListUpdate() {
		this.sendTo(
			"controller",
			new lib.InstanceSaveListUpdateEvent(
				this.id,
				await Instance.listSaves(this.path("saves"), this._loadedSave),
			),
		);
	}

	async _autosave(name) {
		let stat = await fs.stat(this.path("saves", `${name}.zip`));
		instanceFactorioAutosaveSize.labels(String(this.id)).set(stat.size);

		if (
			this.config.get("factorio.player_online_autosave_slots") > 0
			&& (this._hadPlayersOnline || this.playersOnline.size)
		) {
			if (this._playerAutosaveSlot > this.config.get("factorio.player_online_autosave_slots")) {
				this._playerAutosaveSlot = 1;
			}
			await fs.rename(
				this.path("saves", `${name}.zip`),
				this.path("saves", `_autosave_po${this._playerAutosaveSlot}.zip`),
			);
			this._playerAutosaveSlot += 1;
			this._hadPlayersOnline = false;
		}

		await this.sendSaveListUpdate();
	}

	notifyStatus(status) {
		this._status = status;
		this.sendTo(
			"controller",
			new lib.InstanceStatusChangedEvent(
				this.id,
				status,
				this.server && this.server.gamePort || this.config.get("factorio.game_port") || null,
			),
		);
	}

	/**
	 * Current state of the instance
	 *
	 * One of stopped, starting, running, stopping, creating_save and exporting_data
	 *
	 * @returns {string} instance status.
	 */
	get status() {
		return this._status;
	}

	notifyExit() {
		this._loadedSave = null;
		this.notifyStatus("stopped");

		this.config.off("fieldChanged", this._configFieldChanged);
		clearTimeout(this._playerCheckInterval);

		// Clear metrics this instance is exporting
		for (let collector of lib.defaultRegistry.collectors) {
			if (
				collector instanceof lib.ValueCollector
				&& collector.metric.labels.includes("instance_id")
			) {
				collector.removeAll({ instance_id: String(this.id) });
			}
		}

		// Notify plugins of exit
		for (let pluginInstance of this.plugins.values()) {
			pluginInstance.onExit();
		}

		for (let player of this.playersOnline) {
			this._recordPlayerLeave(player, "server_quit");
		}
		this._saveStats().catch(err => this.logger.error(`Error saving stats:\n${err.stack}`));
	}

	async _loadPlugin(pluginInfo, host) {
		let pluginLoadStarted = Date.now();
		let InstancePluginClass = await lib.loadInstancePluginClass(pluginInfo);
		let instancePlugin = new InstancePluginClass(pluginInfo, this, host);
		this.plugins.set(pluginInfo.name, instancePlugin);
		await instancePlugin.init();

		this.logger.info(`Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
	}

	async _loadStats() {
		let instanceStats;
		try {
			instanceStats = JSON.parse(await fs.readFile(this.path("instance-stats.json")));
		} catch (err) {
			if (err.code === "ENOENT") {
				return;
			}
			throw err;
		}
		this.playerStats = new Map(instanceStats["players"].map(([id, stats]) => [id, new PlayerStats(stats)]));
		this._playerAutosaveSlot = instanceStats["player_autosave_slot"] || 1;
	}

	async _saveStats() {
		let content = JSON.stringify({
			players: [...this.playerStats],
			player_autosave_slot: this._playerAutosaveSlot,
		}, null, 4);
		await lib.safeOutputFile(this.path("instance-stats.json"), content);
	}

	async init(pluginInfos) {
		this.notifyStatus("starting");
		try {
			await this._loadStats();
			await this.server.init();
		} catch (err) {
			this.notifyExit();
			await this.sendSaveListUpdate();
			throw err;
		}

		// load plugins
		for (let pluginInfo of pluginInfos) {
			if (
				!pluginInfo.instanceEntrypoint
				|| !this._host.serverPlugins.has(pluginInfo.name)
				|| !this.config.group(pluginInfo.name).get("load_plugin")
			) {
				continue;
			}

			try {
				await this._loadPlugin(pluginInfo, this._host);
			} catch (err) {
				this.notifyExit();
				await this.sendSaveListUpdate();
				throw err;
			}
		}

		let plugins = {};
		for (let [name, plugin] of this.plugins) {
			plugins[name] = plugin.info.version;
		}
		this.send(new lib.InstanceInitialisedEvent(plugins));
	}

	/**
	 * Resolve the effective Factorio server settings
	 *
	 * Use the example settings as the basis and override it with all the
	 * entries from the given settings object.
	 *
	 * @param {Object} overrides - Server settings to override.
	 * @returns {Promise<Object>}
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
		await lib.safeOutputFile(
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
		await fs.ensureDir(path.join(instanceDir, "script-output"));
		await fs.ensureDir(path.join(instanceDir, "saves"));
	}

	/**
	 * Sync instance mods directory with configured mod pack
	 *
	 * Adds, deletes, and updates all files in the instance mods folder to
	 * match up with the mod pack that's configured. If no mod pack is
	 * configured then an empty mod pack is used, esentially turning it into
	 * a vanilla mods folder.  If the instance mods directory does't exist
	 * then it will be created.
	 *
	 * On Linux this creates symlinks to mods in the host's mods folder, on
	 * Windows hard links are used instead due to symlinks being privileged.
	 */
	async syncMods() {
		const modPackId = this.config.get("factorio.mod_pack");
		let modPack;
		if (modPackId === null) {
			modPack = await this.sendTo("controller", new lib.ModPackGetDefaultRequest());
		} else {
			modPack = await this.sendTo("controller", new lib.ModPackGetRequest(modPackId));
		}
		this.activeModPack = modPack;

		// TODO validate factorioVersion

		if (!this._host.config.get("host.mods_directory_is_shared")) {
			throw new Error("Fetching mods is not implemented");
		}

		await fs.ensureDir(this.path("mods"));

		// Remove all files
		for (let entry of await fs.readdir(this.path("mods"), { withFileTypes: true })) {
			if (entry.isDirectory()) {
				this.logger.warn(
					`Found unexpected directory ${entry.name} in mods folder, it may break Clusterio's mod syncing`
				);
				continue;
			}

			if (entry.isFile() || entry.isSymbolicLink()) {
				await fs.unlink(this.path("mods", entry.name));
			}
		}

		// Add mods from mod the pack
		const modsDir = this._host.config.get("host.mods_directory");
		for (let mod of this.activeModPack.mods.values()) {
			const modFile = `${mod.name}_${mod.version}.zip`;
			const target = path.join(modsDir, modFile);
			const link = this.path("mods", modFile);

			if (process.platform !== "win32") {
				await fs.symlink(path.relative(path.dirname(link), target), link);

			// On Windows symlinks require elevated privileges, which is
			// not something we want to have.  For this reason the mods
			// are hard linked instead.
			} else {
				await fs.link(target, link);
			}
		}

		// Write mod-list.json
		await fs.outputFile(this.path("mods", "mod-list.json"), JSON.stringify({
			mods: [...this.activeModPack.mods.values()],
		}, null, 2));

		// Write mod-settings.dat
		await fs.outputFile(this.path("mods", "mod-settings.dat"), this.activeModPack.toModSettingsDat());
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
			lib.safeOutputFile(
				this.server.writePath("server-adminlist.json"),
				JSON.stringify([...this._host.adminlist], null, 4)
			);
		}

		if (this.config.get("factorio.sync_banlist")) {
			this.logger.verbose("Writing server-banlist.json");
			lib.safeOutputFile(
				this.server.writePath("server-banlist.json"),
				JSON.stringify([...this._host.banlist].map(
					([username, reason]) => ({ username, reason })
				), null, 4),
			);
		}

		if (this.config.get("factorio.sync_whitelist")) {
			this.logger.verbose("Writing server-whitelist.json");
			lib.safeOutputFile(
				this.server.writePath("server-whitelist.json"),
				JSON.stringify([...this._host.whitelist], null, 4)
			);
		}

		await this.syncMods();
	}

	/**
	 * Prepare a save for starting
	 *
	 * Creates a new save if no save is passed and patches it with modules.
	 *
	 * @param {string|undefined} saveName -
	 *     Save to prepare from the instance saves directory.  Creates a new
	 *     save if null.
	 * @returns {Promise<string>} Name of the save prepared.
	 */
	async prepareSave(saveName) {
		// Use latest save if no save was specified
		if (saveName === undefined) {
			saveName = await lib.getNewestFile(
				this.path("saves"), (name) => !name.endsWith(".tmp.zip")
			);
		}

		// Create save if no save was found.
		if (saveName === undefined) {
			this.logger.info("Creating new save");
			await this.server.create("world.zip");
			saveName = "world.zip";
		}

		// Load a copy if it's autosave to prevent overwriting the autosave
		if (saveName.startsWith("_autosave")) {
			this.logger.info("Copying autosave");
			let now = new Date();
			let newName = util.format(
				"%s-%s-%s %s%s %s",
				now.getUTCFullYear(),
				(now.getUTCMonth() + 1).toLocaleString("en", { minimumIntegerDigits: 2 }),
				now.getUTCDate().toLocaleString("en", { minimumIntegerDigits: 2 }),
				now.getUTCHours().toLocaleString("en", { minimumIntegerDigits: 2 }),
				now.getUTCMinutes().toLocaleString("en", { minimumIntegerDigits: 2 }),
				saveName,
			);
			await fs.copy(this.path("saves", saveName), this.path("saves", newName));
			saveName = newName;
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

			let module;
			try {
				module = JSON.parse(await fs.readFile(moduleJsonPath));
			} catch (err) {
				throw new Error(`Loading module/module.json in plugin ${pluginName} failed: ${err.message}`);
			}
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
		let modulesDirectory = path.join(__dirname, "..", "modules");
		for (let entry of await fs.readdir(modulesDirectory, { withFileTypes: true })) {
			if (!entry.isFile()) {
				if (modules.has(entry.name)) {
					throw new Error(`Module with name ${entry.name} already exists in a plugin`);
				}

				let moduleJsonPath = path.join(modulesDirectory, entry.name, "module.json");
				if (!await fs.pathExists(moduleJsonPath)) {
					throw new Error(`Module ${entry.name} is missing module.json`);
				}

				let module = JSON.parse(await fs.readFile(moduleJsonPath));
				if (module.name !== entry.name) {
					throw new Error(`Expected name of module ${entry.name} to match the directory name`);
				}

				module = {
					path: path.join(modulesDirectory, entry.name),
					dependencies: { "clusterio": "*" },
					load: [],
					require: [],
					...module,
				};
				modules.set(module.name, module);
			}
		}

		await lib.patch(this.path("saves", saveName), [...modules.values()]);
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
		this._loadedSave = saveName;
		await this.server.start(saveName);

		if (this.config.get("factorio.enable_save_patching")) {
			await this.server.disableAchievements();
			await this.updateInstanceData();
		} else {
			this._watchPlayerJoinsByChat();
		}

		await this.sendSaveListUpdate();
		await lib.invokeHook(this.plugins, "onStart");

		this.notifyStatus("running");
	}

	/**
	 * Start Factorio server by loading a scenario
	 *
	 * Launches the Factorio server for this instance with the given
	 * scenario.
	 *
	 * @param {String} scenario - Name of scenario to load.
	 * @param {?number} seed - seed to use.
	 * @param {?object} mapGenSettings - MapGenSettings to use.
	 * @param {?object} mapSettings - MapSettings to use.
	 */
	async startScenario(scenario, seed, mapGenSettings, mapSettings) {
		this.server.on("rcon-ready", () => {
			this.logger.verbose("RCON connection established");
		});

		this.server.on("exit", () => this.notifyExit());
		await this.server.startScenario(scenario, seed, mapGenSettings, mapSettings);
		this._watchPlayerJoinsByChat();

		await lib.invokeHook(this.plugins, "onStart");

		this.notifyStatus("running");
	}

	/**
	 * Update instance information on the Factorio side
	 */
	async updateInstanceData() {
		let name = lib.escapeString(this.name);
		await this.sendRcon(`/sc clusterio_private.update_instance(${this.id}, "${name}")`, true);
	}

	async updateFactorioSettings(current, previous) {
		current = await this.resolveServerSettings(current);
		previous = await this.resolveServerSettings(previous);

		for (let [key, action] of Object.entries(serverSettingsActions)) {
			if (current[key] !== undefined && !util.isDeepStrictEqual(current[key], previous[key])) {
				await action(this, current[key], this.logger);
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
			for (let player of this._host.whitelist) {
				await this.sendRcon(`/whitelist ${player}`);
			}
		}

		if (enable) {
			await this.sendRcon("/whitelist enable");
		}
	}

	async handleInstanceAdminlistUpdateEvent(request) {
		if (!this.config.get("factorio.sync_adminlist")) {
			return;
		}

		let { name, admin } = request;
		let command = admin ? `/promote ${name}` : `/demote ${name}`;
		await this.sendRcon(command);
	}

	async handleInstanceBanlistUpdateEvent(request) {
		if (!this.config.get("factorio.sync_banlist")) {
			return;
		}

		let { name, banned, reason } = request;
		let command = banned ? `/ban ${name} ${reason}` : `/unban ${name}`;
		await this.sendRcon(command);
	}

	async handleInstanceWhitelistUpdateEvent(request) {
		if (!this.config.get("factorio.sync_whitelist")) {
			return;
		}

		let { name, whitelisted } = request;
		let command = whitelisted ? `/whitelist add ${name}` : `/whiteliste remove ${name}`;
		await this.sendRcon(command);
	}

	/**
	 * Stop the instance
	 */
	async stop() {
		if (this._status === "stopped") {
			return;
		}
		this.notifyStatus("stopping");

		// XXX this needs more thought to it
		if (this.server._state === "running") {
			await lib.invokeHook(this.plugins, "onStop");
			await this.server.stop();
			await this.sendSaveListUpdate();
		}
	}

	async kill() {
		if (this._status === "stopped") {
			return;
		}
		await this.server.kill(true);
	}

	async handleControllerConnectionEvent(event) {
		await lib.invokeHook(this.plugins, "onControllerConnectionEvent", event.event);
	}

	async handlePrepareControllerDisconnectRequest() {
		await lib.invokeHook(this.plugins, "onPrepareControllerDisconnect");
	}

	async handleInstanceMetricsRequest() {
		let results = [];
		if (!["stopped", "stopping"].includes(this._status)) {
			let pluginResults = await lib.invokeHook(this.plugins, "onMetrics");
			for (let metricIterator of pluginResults) {
				for await (let metric of metricIterator) {
					results.push(lib.serializeResult(metric));
				}
			}
		}

		let pid = this.server.pid;
		if (pid) {
			let stats = await pidusage(pid);
			instanceFactorioCpuTime.labels(String(this.id)).set(stats.ctime / 1000);
			instanceFactorioMemoryUsage.labels(String(this.id)).set(stats.memory);
		}

		return new lib.InstanceMetricsRequest.Response(results);
	}

	async handleInstanceStartRequest(request) {
		let saveName = request.save;
		try {
			await this.prepare();
			saveName = await this.prepareSave(saveName);
		} catch (err) {
			this.notifyExit();
			await this.sendSaveListUpdate();
			throw err;
		}

		try {
			await this.start(saveName);
		} catch (err) {
			await this.stop();
			throw err;
		}
	}

	async handleInstanceLoadScenarioRequest(request) {
		if (this.config.get("factorio.enable_save_patching")) {
			this.notifyExit();
			throw new lib.RequestError("Load scenario cannot be used with save patching enabled");
		}

		try {
			await this.prepare();
		} catch (err) {
			this.notifyExit();
			await this.sendSaveListUpdate();
			throw err;
		}

		let { scenario, seed, mapGenSettings, mapSettings } = request;
		try {
			await this.startScenario(scenario, seed, mapGenSettings, mapSettings);
		} catch (err) {
			await this.stop();
			throw err;
		}
	}

	async handleInstanceListSavesRequest() {
		return await Instance.listSaves(this.path("saves"), this._loadedSave);
	}

	async handleInstanceCreateSaveRequest(request) {
		this.notifyStatus("creating_save");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings();

			this.logger.verbose("Creating save .....");
			await this.syncMods();

		} catch (err) {
			this.notifyExit();
			await this.sendSaveListUpdate();
			throw err;
		}

		this.server.on("exit", () => this.notifyExit());
		let { name, seed, mapGenSettings, mapSettings } = request;
		await this.server.create(name, seed, mapGenSettings, mapSettings);
		await this.sendSaveListUpdate();
		this.logger.info("Successfully created save");
	}

	async handleInstanceExportDataRequest() {
		this.notifyStatus("exporting_data");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings();

			this.logger.info("Exporting data .....");
			await this.syncMods();
			let zip = await lib.exportData(this.server);

			let content = await zip.generateAsync({ type: "nodebuffer" });
			let url = new URL(this._host.config.get("host.controller_url"));
			url.pathname += "api/upload-export";
			url.searchParams.set("mod_pack_id", this.activeModPack.id);
			let response = await phin({
				url, method: "PUT",
				data: content,
				core: { ca: this._host.tlsCa },
				headers: {
					"Content-Type": "application/zip",
					"x-access-token": this._host.config.get("host.controller_token"),
				},
			});
			if (response.statusCode !== 200) {
				throw Error(`Upload failed: ${response.statusCode} ${response.statusMessage}: ${response.body}`);
			}

		} finally {
			this.notifyExit();
		}
	}

	async handleInstanceStopRequest() {
		await this.stop();
	}

	async handleInstanceKillRequest() {
		await this.kill();
	}

	async handleInstanceSendRconRequest(request) {
		return await this.sendRcon(request.command);
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

module.exports = Instance;
