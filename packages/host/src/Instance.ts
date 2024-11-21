import fs from "fs-extra";
import path from "path";
import pidusage from "pidusage";
import phin from "phin";
import util from "util";
import type { Static } from "@sinclair/typebox";

// internal libraries
import * as lib from "@clusterio/lib";

import { FactorioServer } from "./server";
import { SaveModule, patch } from "./patch";
import { exportData } from "./export";
import type Host from "./Host";
import BaseInstancePlugin from "./BaseInstancePlugin";

const scriptCommands = [
	"/cheat", "/editor",
	"/command", "/c",
	"/measured-command", "/mc",
	"/silent-command", "/sc",
];

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

function applyAsConfig(name: string) {
	return async function action(instance: Instance, value: unknown, logger: lib.Logger) {
		if (name === "tags" && value instanceof Array) {
			// Replace spaces with non-break spaces and delimit by spaces.
			// This does change the defined tags, but there doesn't seem to
			// be a way to include a space into a tag from the console.
			value = value.map(tag => tag.replace(/ /g, "\u00a0")).join(" ");
		}
		try {
			await instance.sendRcon(`/config set ${name} ${value}`);
		} catch (err: any) {
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
	"visibility": async (instance: Instance, value: unknown, logger: lib.Logger) => {
		for (let scope of ["lan", "public", "steam"]) {
			try {
				let enabled = Boolean((value as Record<string, string>)[scope]);
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
export default class Instance extends lib.Link {
	/**
	 * ID of this instance, equivalenet to `instance.config.get("instance.id")`.
	 */
	readonly id: number;
	plugins: Map<string, BaseInstancePlugin>;
	config: lib.InstanceConfig;
	logger: lib.Logger;
	server: FactorioServer;
	/**
	 * Mod pack currently running on this instance
	 */
	activeModPack!: lib.ModPack; // This is set in syncMods
	/**
	 * Per player statistics recorded by this instance.
	 */
	playerStats: Map<string, lib.PlayerStats> = new Map();
	/**
	 * Players currently online on the instance.
	 */
	playersOnline: Set<string> = new Set();


	_host: Host;
	_dir: string;
	_configFieldChanged: (field: string, curr: unknown, prev: unknown) => void;
	_status: "stopped" | "starting" | "running" | "stopping" | "creating_save" | "exporting_data" = "stopped";
	_loadedSave: string | null = null;
	_playerCheckInterval: ReturnType<typeof setInterval> | undefined;
	_hadPlayersOnline = false;
	_playerAutosaveSlot = 1;


	constructor(
		host: Host,
		connector: lib.VirtualConnector,
		dir: string,
		factorioDir: string,
		instanceConfig: lib.InstanceConfig
	) {
		super(connector);
		this._host = host;
		this._dir = dir;

		this.plugins = new Map();
		this.config = instanceConfig;

		this.id = this.config.get("instance.id");

		this.logger = lib.logger.child({
			instance_id: this.id,
			instance_name: this.name,
		});

		this._configFieldChanged = (field: string, curr: unknown, prev: unknown) => {
			let hook = () => lib.invokeHook(this.plugins, "onInstanceConfigFieldChanged", field, curr, prev);

			if (field === "factorio.shutdown_timeout") {
				this.server.shutdownTimeoutMs = curr as number * 1000;
			} else if (field === "factorio.settings") {
				this.updateFactorioSettings(curr as any, prev as any).finally(hook);
			} else if (field === "factorio.enable_whitelist") {
				this.updateFactorioWhitelist(curr as any).finally(hook);
			} else {
				if (field === "factorio.max_concurrent_commands") {
					this.server.maxConcurrentCommands = curr as number;
				}
				hook();
			}
		};
		this.config.on("fieldChanged", this._configFieldChanged);

		let serverOptions = {
			logger: this.logger,
			version: this.config.get("factorio.version"),
			executablePath: this.config.get("factorio.executable_path") ?? undefined,
			gamePort: this.config.get("factorio.game_port") ?? host.assignGamePort(this.id),
			rconPort: this.config.get("factorio.rcon_port") ?? undefined,
			rconPassword: this.config.get("factorio.rcon_password") ?? undefined,
			enableWhitelist: this.config.get("factorio.enable_whitelist"),
			enableAuthserverBans: this.config.get("factorio.enable_authserver_bans"),
			verboseLogging: this.config.get("factorio.verbose_logging"),
			stripPaths: this.config.get("factorio.strip_paths"),
			maxConcurrentCommands: this.config.get("factorio.max_concurrent_commands"),
			shutdownTimeoutMs: this.config.get("factorio.shutdown_timeout") * 1000,
		};

		this.server = new FactorioServer(
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
		this.handle(lib.InstanceSaveDetailsListRequest, this.handleInstanceSaveDetailsListRequest.bind(this));
		this.handle(lib.InstanceCreateSaveRequest, this.handleInstanceCreateSaveRequest.bind(this));
		this.handle(lib.InstanceExportDataRequest, this.handleInstanceExportDataRequest.bind(this));
		this.handle(lib.InstanceStopRequest, this.handleInstanceStopRequest.bind(this));
		this.handle(lib.InstanceKillRequest, this.handleInstanceKillRequest.bind(this));
		this.handle(lib.InstanceSendRconRequest, this.handleInstanceSendRconRequest.bind(this));
	}

	_watchPlayerJoinsByChat() {
		this.server.on("output", (parsed: lib.ParsedFactorioOutput, line: string) => {
			if (parsed.type !== "action") {
				return;
			}

			let name = /^([^ ]+)/.exec(parsed.message)![1];
			if (parsed.action === "JOIN") {
				this._recordPlayerJoin(name);
			} else if (["LEAVE", "KICK", "BAN"].includes(parsed.action)) {
				let reason = {
					"LEAVE": "quit",
					"KICK": "kicked",
					"BAN": "banned",
				}[parsed.action]!;
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

	_recordPlayerJoin(name: string) {
		if (this.playersOnline.has(name)) {
			return;
		}
		this.playersOnline.add(name);

		let stats = this.playerStats.get(name);
		if (!stats) {
			stats = new lib.PlayerStats();
			this.playerStats.set(name, stats);
		}
		stats.lastJoinAt = new Date();
		if (!stats.firstJoinAt) {
			stats.firstJoinAt = stats.lastJoinAt;
		}
		stats.joinCount += 1;

		let event: lib.PlayerEvent = {
			type: "join",
			name,
			stats,
		};
		this.sendTo("controller", new lib.InstancePlayerUpdateEvent("join", name, stats));
		lib.invokeHook(this.plugins, "onPlayerEvent", event);
	}

	_recordPlayerLeave(name: string, reason: string) {
		if (!this.playersOnline.delete(name)) {
			return;
		}

		let stats = this.playerStats.get(name)!;
		stats.lastLeaveAt = new Date();
		stats.lastLeaveReason = reason;
		stats.onlineTimeMs += stats.lastLeaveAt.getTime() - stats.lastJoinAt!.getTime();
		this._hadPlayersOnline = true;

		let event: lib.PlayerEvent = {
			type: "leave",
			name,
			reason,
			stats,
		};
		this.sendTo("controller", new lib.InstancePlayerUpdateEvent("leave", name, stats, reason));
		lib.invokeHook(this.plugins, "onPlayerEvent", event);
	}

	async handleInstanceExtractPlayersRequest() {
		const exportPlayerTimes = `/sc
local players = {}
for _, p in pairs(game.players) do
	players[p.name] = p.online_time
end
rcon.print(game.table_to_json(players))`.replace(/\r?\n/g, " ");
		let playerTimes: Record<string, number> = JSON.parse(await this.sendRcon(exportPlayerTimes));
		let count = 0;

		for (let [name, onlineTimeTicks] of Object.entries(playerTimes)) {
			let stats = this.playerStats.get(name);
			if (!stats) {
				stats = new lib.PlayerStats();
				this.playerStats.set(name, stats);
			}
			stats.onlineTimeMs = onlineTimeTicks * 1000 / 60;

			let event: lib.PlayerEvent = {
				type: "import",
				name,
				stats,
			};
			this.sendTo("controller", new lib.InstancePlayerUpdateEvent("import", name, stats));
			lib.invokeHook(this.plugins, "onPlayerEvent", event);
			count += 1;
		}
		this.logger.info(`Extracted data for ${count} player(s)`);
	}

	async sendRcon(message: string, expectEmpty = false, plugin = "") {
		const trimmedMessage = message.trim();
		if (
			!this.config.get("factorio.enable_script_commands")
			&& scriptCommands.find(cmd => trimmedMessage.startsWith(cmd))
		) {
			throw new Error(
				"Attempted to use script command while disabled. See config factorio.enable_script_commands.\n" +
				`Command: ${message}`
			);
		}

		let instanceId = String(this.id);
		let observeDuration = instanceRconCommandDuration.labels(instanceId).startTimer();
		try {
			return await this.server.sendRcon(message, expectEmpty);
		} finally {
			observeDuration();
			instanceRconCommandSize.labels(instanceId, plugin).observe(Buffer.byteLength(message, "utf8"));
		}
	}

	static async listSaves(instanceId: number, savesDir: string, loadedSave: string | null) {
		let defaultSave = null;
		if (loadedSave === null) {
			defaultSave = await lib.getNewestFile(
				savesDir, (name) => !name.endsWith(".tmp.zip")
			);
		}

		let list: lib.SaveDetails[] = [];
		for (let name of await fs.readdir(savesDir)) {
			let type: "file" | "directory" | "special";
			let stat = await fs.stat(path.join(savesDir, name));
			if (stat.isFile()) {
				type = "file";
			} else if (stat.isDirectory()) {
				type = "directory";
			} else {
				type = "special";
			}

			list.push(new lib.SaveDetails(
				instanceId,
				type,
				name,
				stat.size,
				stat.mtimeMs,
				name === loadedSave,
				name === defaultSave,
				0, // Set by controller
				false,
			));
		}

		return list;
	}

	async sendSaveListUpdate() {
		this.sendTo(
			"controller",
			new lib.InstanceSaveDetailsUpdatesEvent(
				await Instance.listSaves(this.id, this.path("saves"), this._loadedSave),
				this.id,
			),
		);
	}

	async _autosave(name: string) {
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

	notifyStatus(status: Instance["_status"]) {
		this._status = status;
		this.sendTo(
			"controller",
			new lib.InstanceStatusChangedEvent(
				this.id,
				status,
				this.server.gamePort,
				status === "running"? this.server.version : this.config.get("factorio.version"),
			),
		);
	}

	/**
	 * Current state of the instance
	 *
	 * One of stopped, starting, running, stopping, creating_save and exporting_data
	 */
	get status() {
		return this._status;
	}

	notifyExit() {
		this._loadedSave = null;
		this.notifyStatus("stopped");
		this.connector.emit("close");

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

	async _loadPlugin(pluginInfo: lib.PluginNodeEnvInfo, host: Host) {
		let pluginLoadStartedMs = Date.now();
		let InstancePluginClass = await lib.loadPluginClass(
			pluginInfo.name,
			path.posix.join(pluginInfo.requirePath, pluginInfo.instanceEntrypoint!),
			"InstancePlugin",
			BaseInstancePlugin,
		);
		let instancePlugin = new InstancePluginClass(pluginInfo, this, host);
		this.plugins.set(pluginInfo.name, instancePlugin);
		await instancePlugin.init();

		this.logger.info(`Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStartedMs}ms`);
	}

	async _loadStats() {
		let instanceStats;
		try {
			instanceStats = JSON.parse(await fs.readFile(this.path("instance-stats.json"), "utf8"));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				return;
			}
			throw err;
		}
		this.playerStats = new Map(instanceStats["players"].map(
			([id, stats]: [number, Static<typeof lib.PlayerStats.jsonSchema>]) => [id, new lib.PlayerStats(stats)])
		);
		this._playerAutosaveSlot = instanceStats["player_autosave_slot"] || 1;
	}

	async _saveStats() {
		let content = JSON.stringify({
			players: [...this.playerStats],
			player_autosave_slot: this._playerAutosaveSlot,
		}, null, "\t");
		await lib.safeOutputFile(this.path("instance-stats.json"), content);
	}

	async init(pluginInfos: lib.PluginNodeEnvInfo[]) {
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
				|| !this.config.get(`${pluginInfo.name}.load_plugin` as keyof lib.InstanceConfigFields)
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

		let plugins: Record<string, string> = {};
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
	 * @param overrides - Server settings to override.
	 * @param includeCredentials - Include Factorio username and token from host/controller config.
	 * @returns
	 *     server example settings with the given settings applied over it.
	 */
	async resolveServerSettings(overrides: Record<string, unknown>, includeCredentials: boolean) {
		let serverSettings = await this.server.exampleSettings();
		if (includeCredentials && overrides.username === undefined && overrides.token === undefined) {
			let credentials = {
				username: this._host.config.get("host.factorio_username") ?? undefined,
				token: this._host.config.get("host.factorio_token") ?? undefined,
			};
			if (!credentials.username && !credentials.token) {
				Object.assign(credentials, await this.sendTo("controller", new lib.GetFactorioCredentialsRequest()));
				if (credentials.username || credentials.token) {
					this.logger.info("Using Factorio credentials from controller config");
				} else {
					this.logger.warn("No Factorio credentials found");
				}
			} else {
				this.logger.info("Using Factorio credentials from host config");
			}
			if (credentials.username) { serverSettings.username = credentials.username; }
			if (credentials.token) { serverSettings.token = credentials.token; }
		} else if (includeCredentials) {
			this.logger.info("Using Factorio credentials from instance config");
		}

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
	 *
	 * @param includeCredentials - Include Factorio username and token from host/controller config.
	 */
	async writeServerSettings(includeCredentials: boolean) {
		const warning = "Changes to this file will be overwitten by the factorio.settings config on the instance.";
		const serverSettings = {
			"_comment_warning": warning,
			...await this.resolveServerSettings(this.config.get("factorio.settings"), includeCredentials),
		};
		await lib.safeOutputFile(
			this.server.writePath("server-settings.json"),
			JSON.stringify(serverSettings, null, "\t")
		);
	}

	/**
	 * Creates a new empty instance directory
	 *
	 * Creates the neccessary files for starting up a new instance into the
	 * provided instance directory.
	 *
	 * @param instanceDir -
	 *     Directory to create the new instance into.
	 * @param factorioDir - Path to factorio installation.
	 */
	static async create(instanceDir: string, factorioDir: string) {
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
		this.logger.info("Syncing mods");
		const modPackId = this.config.get("factorio.mod_pack_id");
		let modPack;
		if (modPackId === null) {
			modPack = await this.sendTo("controller", new lib.ModPackGetDefaultRequest());
		} else {
			modPack = await this.sendTo("controller", new lib.ModPackGetRequest(modPackId));
		}
		this.activeModPack = modPack;

		// TODO validate factorioVersion

		const mods = await this._host.fetchMods(modPack.mods.values());

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
		for (let mod of mods) {
			const modFile = mod.filename;
			const target = path.join(modsDir, modFile);
			const link = this.path("mods", modFile);

			if (process.platform !== "win32") {
				await fs.symlink(path.relative(path.dirname(link), target), link);

			// On Windows symlinks require elevated privileges, which is
			// not something we want to have.  For this reason the mods
			// are hard linked instead.
			} else {
				try {
					await fs.link(target, link);
				} catch (err) {
					this.logger.warn(`Failed to link mod ${modFile}.`);
				}
			}
		}

		// Write mod-list.json
		await fs.outputFile(this.path("mods", "mod-list.json"), JSON.stringify({
			mods: [...this.activeModPack.mods.values()],
		}, null, "\t"));

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
		await this.writeServerSettings(true);

		if (this.config.get("factorio.sync_adminlist")) {
			this.logger.verbose("Writing server-adminlist.json");
			lib.safeOutputFile(
				this.server.writePath("server-adminlist.json"),
				JSON.stringify([...this._host.adminlist], null, "\t")
			);
		}

		if (this.config.get("factorio.sync_banlist")) {
			this.logger.verbose("Writing server-banlist.json");
			lib.safeOutputFile(
				this.server.writePath("server-banlist.json"),
				JSON.stringify([...this._host.banlist].map(
					([username, reason]) => ({ username, reason })
				), null, "\t"),
			);
		}

		if (this.config.get("factorio.sync_whitelist")) {
			this.logger.verbose("Writing server-whitelist.json");
			lib.safeOutputFile(
				this.server.writePath("server-whitelist.json"),
				JSON.stringify([...this._host.whitelist], null, "\t")
			);
		}

		await this.syncMods();
	}

	/**
	 * Prepare a save for starting
	 *
	 * Creates a new save if no save is passed and patches it with modules.
	 *
	 * @param saveName -
	 *     Save to prepare from the instance saves directory.  Creates a new
	 *     save if null.
	 * @returns Name of the save prepared.
	 */
	async prepareSave(saveName?: string) {
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
		let modules: Map<string, SaveModule> = new Map();
		for (let plugin of this.plugins.values()) {
			let module = await SaveModule.fromPlugin(plugin);
			if (!module) {
				continue;
			}
			modules.set(module.info.name, module);
		}

		// Find stand alone modules to load
		// XXX for now only the included clusterio module is loaded
		let modulesDirectory = path.join(__dirname, "..", "..", "..", "modules");
		for (let entry of await fs.readdir(modulesDirectory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (modules.has(entry.name)) {
					throw new Error(`Module with name ${entry.name} already exists in a plugin`);
				}
				let module = await SaveModule.fromDirectory(path.join(modulesDirectory, entry.name));
				modules.set(module.info.name, module);
			}
		}

		await patch(this.path("saves", saveName), [...modules.values()]);
		return saveName;
	}

	/**
	 * Start Factorio server
	 *
	 * Launches the Factorio server for this instance with the given save.
	 *
	 * @param saveName - Name of save game to load.
	 */
	async start(saveName: string) {
		this.server.on("rcon-ready", () => {
			this.logger.verbose("RCON connection established");
		});

		this.server.on("exit", () => this.notifyExit());
		this._loadedSave = saveName;
		await this.server.start(saveName);

		if (this.config.get("factorio.enable_save_patching") && this.config.get("factorio.enable_script_commands")) {
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
	 * @param scenario - Name of scenario to load.
	 * @param seed - seed to use.
	 * @param mapGenSettings - MapGenSettings to use.
	 * @param mapSettings - MapSettings to use.
	 */
	async startScenario(scenario: string, seed?: number, mapGenSettings?: object, mapSettings?: object) {
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

	async updateFactorioSettings(current: Record<string, unknown>, previous: Record<string, unknown>) {
		current = await this.resolveServerSettings(current, false);
		previous = await this.resolveServerSettings(previous, false);

		for (let [key, action] of Object.entries(serverSettingsActions)) {
			if (current[key] !== undefined && !util.isDeepStrictEqual(current[key], previous[key])) {
				await action(this, current[key], this.logger);
			}
		}
	}

	/**
	 * Enable or disable the player whitelist
	 *
	 * @param enable -
	 *     True to enable the whitelist, False to disable the whitelist.
	 */
	async updateFactorioWhitelist(enable: boolean) {
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

	async handleInstanceAdminlistUpdateEvent(request: lib.InstanceAdminlistUpdateEvent) {
		if (!this.config.get("factorio.sync_adminlist")) {
			return;
		}

		let { name, admin } = request;
		let command = admin ? `/promote ${name}` : `/demote ${name}`;
		await this.sendRcon(command);
	}

	async handleInstanceBanlistUpdateEvent(request: lib.InstanceBanlistUpdateEvent) {
		if (!this.config.get("factorio.sync_banlist")) {
			return;
		}

		let { name, banned, reason } = request;
		let command = banned ? `/ban ${name} ${reason}` : `/unban ${name}`;
		await this.sendRcon(command);
	}

	async handleInstanceWhitelistUpdateEvent(request: lib.InstanceWhitelistUpdateEvent) {
		if (!this.config.get("factorio.sync_whitelist")) {
			return;
		}

		let { name, whitelisted } = request;
		let command = whitelisted ? `/whitelist add ${name}` : `/whitelist remove ${name}`;
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
		} else if (
			this.server._state === "stopping"
			|| this.server._state === "create"
		) {
			await this.server.kill();
		}
	}

	async kill() {
		if (this._status === "stopped") {
			return;
		}
		await this.server.kill(true);
	}

	async handleControllerConnectionEvent(event: lib.ControllerConnectionEvent) {
		await lib.invokeHook(this.plugins, "onControllerConnectionEvent", event.event);
	}

	async handlePrepareControllerDisconnectRequest() {
		await lib.invokeHook(this.plugins, "onPrepareControllerDisconnect", this);
	}

	async handleInstanceMetricsRequest() {
		let results: ReturnType<typeof lib.serializeResult>[] = [];
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

	async handleInstanceStartRequest(request: lib.InstanceStartRequest) {
		let saveName = request.save;
		try {
			try {
				await this.prepare();
				saveName = await this.prepareSave(saveName);
			} catch (err: any) {
				this.logger.error(`Error preparing instance: ${err.message}`);
				this.notifyExit();
				await this.sendSaveListUpdate();
				throw err;
			}

			try {
				await this.start(saveName);
			} catch (err: any) {
				this.logger.error(`Error starting ${saveName}: ${err.message}`);
				await this.stop();
				throw err;
			}
		} finally {
			this.logger.verbose("Wiping credentials from server-settings.json");
			await this.writeServerSettings(false);
		}
	}

	async handleInstanceLoadScenarioRequest(request: lib.InstanceLoadScenarioRequest) {
		if (this.config.get("factorio.enable_save_patching")) {
			this.notifyExit();
			throw new lib.RequestError("Load scenario cannot be used with save patching enabled");
		}

		try {
			try {
				await this.prepare();
			} catch (err: any) {
				this.logger.error(`Error preparing instance: ${err.message}`);
				this.notifyExit();
				await this.sendSaveListUpdate();
				throw err;
			}

			let { scenario, seed, mapGenSettings, mapSettings } = request;
			try {
				await this.startScenario(scenario, seed, mapGenSettings, mapSettings);
			} catch (err: any) {
				this.logger.error(`Error starting scenario ${scenario}: ${err.message}`);
				await this.stop();
				throw err;
			}
		} finally {
			this.logger.verbose("Wiping credentials from server-settings.json");
			await this.writeServerSettings(false);
		}
	}

	async handleInstanceSaveDetailsListRequest() {
		return await Instance.listSaves(this.id, this.path("saves"), this._loadedSave);
	}

	async handleInstanceCreateSaveRequest(request: lib.InstanceCreateSaveRequest) {
		this.notifyStatus("creating_save");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings(false);
			await this.syncMods();

		} catch (err: any) {
			this.logger.error(`Error preparing instance: ${err.message}`);
			this.notifyExit();
			await this.sendSaveListUpdate();
			throw err;
		}

		this.server.on("exit", () => this.notifyExit());
		let { name, seed, mapGenSettings, mapSettings } = request;

		try {
			this.logger.info("Creating save");
			await this.server.create(name, seed, mapGenSettings, mapSettings);
		} catch (err: any) {
			this.logger.error(`Error creating save ${name}: ${err.message}`);
			throw err;
		}
		await this.sendSaveListUpdate();
		this.logger.info("Successfully created save");
	}

	async handleInstanceExportDataRequest() {
		this.notifyStatus("exporting_data");
		try {
			this.logger.verbose("Writing server-settings.json");
			await this.writeServerSettings(false);

			this.logger.info("Exporting data .....");
			await this.syncMods();
			let zip = await exportData(this.server);

			let content = await zip.generateAsync({ type: "nodebuffer" });
			let url = new URL(this._host.config.get("host.controller_url"));
			url.pathname += "api/upload-export";
			url.searchParams.set("mod_pack_id", String(this.activeModPack.id));
			let response = await phin({
				url, method: "PUT",
				data: content,
				core: { ca: this._host.tlsCa } as object,
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

	async handleInstanceSendRconRequest(request: lib.InstanceSendRconRequest) {
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
	 * @returns path in instance directory.
	 */
	path(...parts: string[]) {
		return path.join(this._dir, ...parts);
	}
}
