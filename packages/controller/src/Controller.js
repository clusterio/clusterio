"use strict";
const compression = require("compression");
const events = require("events");
const express = require("express");
const fs = require("fs-extra");
const http = require("http");
const https = require("https");
const jwt = require("jsonwebtoken");
const path = require("path");
const stream = require("stream");

const lib = require("@clusterio/lib");
const { logger } = lib;

const HttpCloser = require("./HttpCloser");
const InstanceInfo = require("./InstanceInfo");
const metrics = require("./metrics");
const routes = require("./routes");
const UserManager = require("./UserManager");
const WsServer = require("./WsServer");


const endpointDurationSummary = new lib.Summary(
	"clusterio_controller_http_endpoint_duration_seconds",
	"Time it took to respond to a an HTTP request",
	{ labels: ["route"] }
);

const logSizeGauge = new lib.Gauge(
	"clusterio_controller_log_bytes",
	"Size of all log files currently stored on the controller."
);

/**
 * Manages all controller related operations
 * @alias module:controller/src/Controller
 */
class Controller {
	constructor(clusterLogger, pluginInfos, configPath, config) {
		this.clusterLogger = clusterLogger;
		/**
		 * Array of plugin info objects for known plugins
		 * @type {Array<object>}
		 */
		this.pluginInfos = pluginInfos;
		this.configPath = configPath;
		/**
		 * Controller config.
		 * @type {module:lib.ControllerConfig}
		 */
		this.config = config;

		this.app = express();
		this.app.locals.controller = this;
		this.app.locals.streams = new Map();

		/**
		 * Mapping of host id to host info
		 * @type {Map<number, Object>}
		 */
		this.hosts = null;

		/**
		 * Mapping of instance id to instance info
		 * @type {Map<number, module:controller/src/InstanceInfo>}
		 */
		this.instances = null;

		/**
		 * Mapping of mod pack id to mod pack
		 * @type {Map<number, module:lib.ModPack>}
		 */
		this.modPacks = null;

		/**
		 * Mapping of mod names to mod infos
		 * @type {Map<string, module:lib.ModInfo>}
		 */
		this.mods = null;

		/**
		 * User and roles manager for the cluster
		 * @type {module:controller/src/UserManager}
		 */
		this.userManager = null;
		this.httpServer = null;
		this.httpServerCloser = null;
		this.httpsServer = null;
		this.httpsServerCloser = null;

		/**
		 * Mapping of plugin name to loaded plugin
		 * @type {Map<string, module:lib.BaseControllerPlugin>}
		 */
		this.plugins = new Map();

		/**
		 * WebSocket server
		 * @type {module:controller/src/WsServer}
		 */
		this.wsServer = new WsServer(this);

		this.debugEvents = new events.EventEmitter();
		this._events = new events.EventEmitter();
		// Possible states are new, starting, running, stopping, stopped
		this._state = "new";
		this._shouldStop = false;

		this._fallbackedRequests = new Map();
		this._registeredRequests = new Map();
		this._registeredEvents = new Map();
		this._snoopedEvents = new Map();

		this.devMiddleware = null;
	}

	async start(args) {
		if (this._state !== "new") {
			throw new Error(`Cannot start in state ${this._state}`);
		}

		this._state = "starting";
		try {
			await this._startInternal(args);

		} catch (err) {
			await this._stopInternal();
			this._state = "stopped";
			this._events.emit("stop");
			throw err;
		}

		if (this._shouldStop) {
			this.stop();
		}
	}

	/**
	 * Get the total size of the logs stored
	 *
	 * @returns {Promise<number>} size in bytes of stored log files.
	 */
	async logSize() {
		return (await Promise.all([
			lib.directorySize(path.join(this.logDirectory, "cluster")),
			lib.directorySize(path.join(this.logDirectory, "controller")),
			lib.directorySize(path.join(this.logDirectory, "host")),
		])).reduce((a, v) => a + v, 0);
	}

	async _startInternal(args) {
		this.logDirectory = args.logDirectory;
		this.clusterLogIndex = await lib.LogIndex.load(path.join(this.logDirectory, "cluster"));
		this.clusterLogBuildInterval = setInterval(() => {
			this.clusterLogIndex.buildIndex().catch(
				err => logger.error(`Error building cluster log index:\n${err.stack}`)
			);
		}, 600e3);
		logSizeGauge.callback = async () => { logSizeGauge.set(await this.logSize()); };

		// Start webpack development server if enabled
		if (args.dev || args.devPlugin) {
			logger.warn("Webpack development mode enabled");
			/* eslint-disable node/global-require, node/no-unpublished-require */
			const webpack = require("webpack");
			const webpackDevMiddleware = require("webpack-dev-middleware");
			const webpackConfigs = [];
			if (args.dev) {
				webpackConfigs.push(require("../webpack.config")({}));
			}
			if (args.devPlugin) {
				let devPlugins = new Map();
				for (let name of args.devPlugin) {
					let info = this.pluginInfos.find(i => i.name === name);
					if (!info) {
						throw new lib.StartupError(`No plugin named ${name}`);
					}
					let config = require(path.posix.join(info.requirePath, "webpack.config"))({});
					devPlugins.set(name, webpackConfigs.length);
					webpackConfigs.push(config);
				}
				this.app.locals.devPlugins = devPlugins;
			}
			/* eslint-enable node/global-require, node/no-unpublished-require */

			const compiler = webpack(webpackConfigs);
			this.devMiddleware = webpackDevMiddleware(compiler, { serverSideRender: true });
			this.app.use(this.devMiddleware);
		}

		let databaseDirectory = this.config.get("controller.database_directory");
		await fs.ensureDir(databaseDirectory);

		this.hosts = await Controller.loadHosts(path.join(databaseDirectory, "hosts.json"));
		this.instances = await Controller.loadInstances(path.join(databaseDirectory, "instances.json"));
		this.modPacks = await Controller.loadModPacks(path.join(databaseDirectory, "mod-packs.json"));
		this.userManager = new UserManager(this.config);
		await this.userManager.load(path.join(databaseDirectory, "users.json"));

		let modsDirectory = this.config.get("controller.mods_directory");
		await fs.ensureDir(modsDirectory);
		this.mods = await Controller.loadModInfos(modsDirectory);

		this.config.on("fieldChanged", (group, field, prev) => {
			lib.invokeHook(this.plugins, "onControllerConfigFieldChanged", group, field, prev);
		});
		for (let instance of this.instances.values()) {
			this.addInstanceHooks(instance);
		}

		// Make sure we're actually going to listen on a port
		let httpPort = this.config.get("controller.http_port");
		let httpsPort = this.config.get("controller.https_port");
		let bindAddress = this.config.get("controller.bind_address") || "";
		if (!httpPort && !httpsPort) {
			logger.fatal("Error: at least one of http_port and https_port must be configured");
			process.exitCode = 1;
			return;
		}

		let tls_cert = this.config.get("controller.tls_certificate");
		let tls_key = this.config.get("controller.tls_private_key");

		if (httpsPort && (!tls_cert || !tls_key)) {
			throw new lib.StartupError(
				"tls_certificate and tls_private_key must be configure in order to use https_port"
			);
		}

		Controller.addAppRoutes(this.app, this.pluginInfos);

		if (!args.dev) {
			let manifest = await Controller.loadJsonObject(path.join(__dirname, "..", "dist", "web", "manifest.json"));
			if (!manifest["main.js"]) {
				logger.error("Missing main.js entry in dist/web/manifest.json");
			}
			this.app.locals.mainBundle = manifest["main.js"] || "no_web_build";
		}

		// Load plugins
		await this.loadPlugins();

		this.wsServer = new WsServer(this);

		// Only start listening for connections after all plugins have loaded
		if (httpPort) {
			this.httpServer = http.createServer(this.app);
			this.httpServerCloser = new HttpCloser(this.httpServer);
			await this.listen(this.httpServer, httpPort, bindAddress);
			logger.info(`Listening for HTTP on port ${this.httpServer.address().port}`);
		}

		if (httpsPort) {
			let certificate, privateKey;
			try {
				certificate = await fs.readFile(tls_cert);
				privateKey = await fs.readFile(tls_key);

			} catch (err) {
				throw new lib.StartupError(
					`Error loading ssl certificate: ${err.message}`
				);
			}

			this.httpsServer = https.createServer({
				key: privateKey,
				cert: certificate,
			}, this.app);
			this.httpsServerCloser = new HttpCloser(this.httpsServer);
			await this.listen(this.httpsServer, httpsPort, bindAddress);
			logger.info(`Listening for HTTPS on port ${this.httpsServer.address().port}`);
		}

		logger.info("Started controller");
		this._state = "running";
	}

	/**
	 * Stops the controller.
	 *
	 * Save data and bring down the active connections.  This is the reverse
	 * of start and is valid at any point in time.
	 */
	async stop() {
		if (this._state === "starting") {
			this._shouldStop = true;
			await events.once(this._events, "stop");
			return;

		} else if (this._state === "running") {
			await this._stopInternal();
		}

		this._state = "stopped";
		this._events.emit("stop");
	}

	async _stopInternal() {
		// This function should never throw.
		this._state = "stopping";
		logger.info("Stopping controller");
		clearInterval(this.clusterLogBuildInterval);
		if (this.clusterLogIndex) {
			await this.clusterLogIndex.save();
		}

		logger.info("Saving config");
		await lib.safeOutputFile(this.configPath, JSON.stringify(this.config.serialize(), null, 4));

		if (this.devMiddleware) {
			await new Promise((resolve, reject) => { this.devMiddleware.close(resolve); });
		}

		let databaseDirectory = this.config.get("controller.database_directory");
		if (this.hosts) {
			await Controller.saveHosts(path.join(databaseDirectory, "hosts.json"), this.hosts);
		}

		if (this.instances) {
			await Controller.saveInstances(path.join(databaseDirectory, "instances.json"), this.instances);
		}

		if (this.modPacks) {
			await Controller.saveModPacks(path.join(databaseDirectory, "mod-packs.json"), this.modPacks);
		}

		if (this.userManager) {
			await this.userManager.save(path.join(databaseDirectory, "users.json"));
		}

		await lib.invokeHook(this.plugins, "onShutdown");

		if (this.wsServer) {
			await this.wsServer.stop();
		}

		let stopTasks = [];
		logger.info("Stopping HTTP(S) server");
		if (this.httpServer && this.httpServer.listening) { stopTasks.push(this.httpServerCloser.close()); }
		if (this.httpsServer && this.httpsServer.listening) { stopTasks.push(this.httpsServerCloser.close()); }
		await Promise.all(stopTasks);

		logger.info("Goodbye");
	}

	static async loadHosts(filePath) {
		let serialized;
		try {
			serialized = JSON.parse(await fs.readFile(filePath));

		} catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}

			return new Map();
		}

		// TODO: Remove after release.
		if (serialized.length && !(serialized[0] instanceof Array)) {
			return new Map(); // Discard old format.
		}

		return new Map(serialized);
	}

	static async saveHosts(filePath, hosts) {
		await lib.safeOutputFile(filePath, JSON.stringify([...hosts.entries()], null, 4));
	}

	static async loadInstances(filePath) {
		logger.info(`Loading ${filePath}`);

		let instances = new Map();
		try {
			let serialized = JSON.parse(await fs.readFile(filePath));
			for (let serializedConfig of serialized) {
				let instanceConfig = new lib.InstanceConfig("controller");
				await instanceConfig.load(serializedConfig);
				let status = instanceConfig.get("instance.assigned_host") === null ? "unassigned" : "unknown";
				let instance = new InstanceInfo({ config: instanceConfig, status });
				instances.set(instanceConfig.get("instance.id"), instance);
			}

		} catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}

		return instances;
	}

	static async saveInstances(filePath, instances) {
		let serialized = [];
		for (let instance of instances.values()) {
			serialized.push(instance.config.serialize());
		}

		await lib.safeOutputFile(filePath, JSON.stringify(serialized, null, 4));
	}

	static async loadModPacks(filePath) {
		let json;
		try {
			json = JSON.parse(await fs.readFile(filePath));
		} catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}
		return new Map(json.map(e => [e.id, lib.ModPack.fromJSON(e)]));
	}

	static async saveModPacks(filePath, modPacks) {
		await lib.safeOutputFile(filePath, JSON.stringify([...modPacks.values()], null, 4));
	}

	static async loadModInfos(modsDirectory) {
		let mods = new Map();
		for (let entry of await fs.readdir(modsDirectory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				logger.warn(`Ignoring ${entry.name}${path.sep} in mods directory.`);
				continue;
			}

			if (entry.name.toLowerCase().endsWith("tmp.zip")) {
				continue;
			}

			logger.info(`Loading info for Mod ${entry.name}`);
			let modInfo;
			try {
				modInfo = await lib.ModInfo.fromModFile(path.join(modsDirectory, entry.name));
			} catch (err) {
				logger.error(`Error loading mod ${entry.name}: ${err.message}`);
				continue;
			}

			if (modInfo.filename !== entry.name) {
				logger.error(
					`Mod ${entry.name}'s filename does not match the expected ` +
					`name ${modInfo.filename}, it will be ignored.`
				);
				continue;
			}

			mods.set(modInfo.filename, modInfo);
		}
		return mods;
	}

	static async loadJsonObject(filePath, throwOnMissing = false) {
		let manifest = {};
		try {
			manifest = JSON.parse(await fs.readFile(filePath));
		} catch (err) {
			if (!throwOnMissing && err.code !== "ENOENT") {
				throw err;
			}
		}
		return manifest;
	}

	async deleteMod(name, version) {
		let filename = `${name}_${version}.zip`;
		let mod = this.mods.get(filename);
		if (!mod) {
			throw new Error(`Mod ${filename} does not exist`);
		}

		let modsDirectory = this.config.get("controller.mods_directory");
		await fs.unlink(path.join(modsDirectory, filename));
		this.mods.delete(filename);
		mod.isDeleted = true;
		this.modUpdated(mod);
	}

	/**
	 * Query controller log
	 *
	 * @param {module:lib~QueryLogFilter} filter -
	 *     Filter to limit entries with. Note that only the controller log can
	 *     be queried from this function.
	 * @returns {Promise<Array<Object>>} log entries matching the filter
	 */
	async queryControllerLog(filter) {
		return await lib.queryLog(
			path.join(this.logDirectory, "controller"), filter,
		);
	}

	/**
	 * Query cluster log
	 *
	 * @param {module:lib~QueryLogFilter} filter -
	 *     Filter to limit entries with.
	 * @returns {Promise<Array<Object>>} log entries matching the filter
	 */
	async queryClusterLog(filter) {
		return await lib.queryLog(
			path.join(this.logDirectory, "cluster"), filter, this.clusterLogIndex,
		);
	}

	static addAppRoutes(app, pluginInfos) {
		app.use((req, res, next) => {
			let start = process.hrtime.bigint();
			stream.finished(res, () => {
				let routePath = "static";
				if (req.route && req.route.path) {
					routePath = req.route.path;
				}
				let end = process.hrtime.bigint();
				endpointDurationSummary.labels(routePath).observe(Number(end - start) / 1e9);
			});
			next();
		});
		app.use(compression());

		// Set folder to serve static content from (the website)
		const staticOptions = { immutable: true, maxAge: 1000 * 86400 * 365 };
		app.use("/static", express.static(path.join(__dirname, "..", "dist", "web", "static"), staticOptions));
		app.use("/static", express.static("static", staticOptions)); // Used for data export files

		// Add API routes
		routes.addRouteHandlers(app);

		// Add routes for the web interface
		for (let route of routes.webRoutes) {
			app.get(route, Controller.serveWeb(route));
		}
		for (let pluginInfo of pluginInfos) {
			for (let route of pluginInfo.routes || []) {
				app.get(route, Controller.serveWeb(route));
			}

			let pluginPackagePath = require.resolve(path.posix.join(pluginInfo.requirePath, "package.json"));
			let webPath = path.join(path.dirname(pluginPackagePath), "dist", "web", "static");
			app.use("/static", express.static(webPath, staticOptions));
		}
	}

	/**
	 * Generate access token for host
	 *
	 * @param {number} hostId - ID of host to generate a token for.
	 * @returns {string} access token for host
	 */
	generateHostToken(hostId) {
		return jwt.sign(
			{ aud: "host", host: hostId },
			Buffer.from(this.config.get("controller.auth_secret"), "base64")
		);
	}

	hostUpdated(host) {
		let update = new lib.HostDetails(
			host.agent,
			host.version,
			host.name,
			host.id,
			this.wsServer.hostConnections.has(host.id),
			host.public_address === null ? undefined : host.public_address,
		);

		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.hostUpdated(host, update);
		}
	}

	/**
	 * Get instance by ID for a request
	 *
	 * @param {number} instanceId - ID of instance to get.
	 * @returns {object} instance
	 * @throws {module:lib.RequestError} if the instance does not exist.
	 */
	getRequestInstance(instanceId) {
		let instance = this.instances.get(instanceId);
		if (!instance) {
			throw new lib.RequestError(`Instance with ID ${instanceId} does not exist`);
		}
		return instance;
	}

	/**
	 * Create a new instance
	 *
	 * Adds common Factorio settings to the provided instance config then
	 * creates an instance using that config in the cluster.
	 *
	 * @example
	 * let instanceConfig = new lib.InstanceConfig("controller");
	 * await instanceConfig.init();
	 * instanceConfig.set("instance.name", "My instance");
	 * let instance = await controller.instanceAssign(instanceConfig);
	 * await controller.instanceAssign(instance.id, hostId);
	 *
	 * @param {module:lib.InstanceConfig} instanceConfig -
	 *     Config to base newly created instance on.
	 * @returns {module:controller/src/InstanceInfo} The created instance
	 */
	async instanceCreate(instanceConfig) {
		let instanceId = instanceConfig.get("instance.id");
		if (this.instances.has(instanceId)) {
			throw new lib.RequestError(`Instance with ID ${instanceId} already exists`);
		}

		// Add common settings for the Factorio server
		let settings = {
			"name": `${this.config.get("controller.name")} - ${instanceConfig.get("instance.name")}`,
			"description": `Clusterio instance for ${this.config.get("controller.name")}`,
			"tags": ["clusterio"],
			"max_players": 0,
			"visibility": { "public": true, "lan": true },
			"username": "",
			"token": "",
			"game_password": "",
			"require_user_verification": true,
			"max_upload_in_kilobytes_per_second": 0,
			"max_upload_slots": 5,
			"ignore_player_limit_for_returning_players": false,
			"allow_commands": "admins-only",
			"autosave_interval": 10,
			"autosave_slots": 5,
			"afk_autokick_interval": 0,
			"auto_pause": false,
			"only_admins_can_pause_the_game": true,
			"autosave_only_on_server": true,

			...instanceConfig.get("factorio.settings"),
		};
		instanceConfig.set("factorio.settings", settings);

		let instance = new InstanceInfo({ config: instanceConfig, status: "unassigned" });
		this.instances.set(instanceId, instance);
		await lib.invokeHook(this.plugins, "onInstanceStatusChanged", instance, null);
		this.addInstanceHooks(instance);
	}

	/**
	 * Change assigned host of an instance
	 *
	 * Unassigns instance from existing host if already assigned to one and
	 * then assigns it to the given host.  This is the only supported way of
	 * changing the instance.assigned_host config entry.
	 *
	 * Note: this will not transfer any files or saves stored on the host
	 * the instance was previously assgined to the new one.
	 *
	 * @param {number} instanceId - ID of Instance to assign.
	 * @param {number} hostId - ID of host to assign instance to.
	 */
	async instanceAssign(instanceId, hostId) {
		let instance = this.getRequestInstance(instanceId);

		// Check if target host is connected
		let newHostConnection;
		if (hostId !== null) {
			newHostConnection = this.wsServer.hostConnections.get(hostId);
			if (!newHostConnection) {
				// The case of the host not getting the assign instance message
				// still have to be handled, so it's not a requirement that the
				// target host be connected to the controller while doing the
				// assignment, but it is IMHO a better user experience if this
				// is the case.
				throw new lib.RequestError("Target host is not connected to the controller");
			}
		}

		// Unassign from currently assigned host if it is connected.
		let currentAssignedHost = instance.config.get("instance.assigned_host");
		if (currentAssignedHost !== null && hostId !== currentAssignedHost) {
			let oldHostConnection = this.wsServer.hostConnections.get(currentAssignedHost);
			if (oldHostConnection && !oldHostConnection.connector.closing) {
				await oldHostConnection.send(new lib.InstanceUnassignInternalRequest(instanceId));
			}
		}

		// Assign to target
		instance.config.set("instance.assigned_host", hostId);
		if (hostId !== null) {
			await newHostConnection.send(
				new lib.InstanceAssignInternalRequest(instanceId, instance.config.serialize("host"))
			);
		} else {
			instance.status = "unassigned";
			this.instanceUpdated(instance);
		}
	}

	/**
	 * Delete an instance
	 *
	 * Permanently deletes the instance from its assigned host (if assigned)
	 * and the controller.  This action cannot be undone.
	 *
	 * @param {number} instanceId - ID of instance to delete.
	 */
	async instanceDelete(instanceId) {
		let instance = this.getRequestInstance(instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId !== null) {
			await this.sendTo({ hostId }, new lib.InstanceDeleteInternalRequest(instanceId));
		}
		this.instances.delete(instanceId);

		let prev = instance.status;
		instance.status = "deleted";
		this.instanceUpdated(instance);
		await lib.invokeHook(this.plugins, "onInstanceStatusChanged", instance, prev);
	}

	/**
	 * Notify the config of an instance updated
	 *
	 * Used to push config changes to the assigned host when the config of
	 * an instance has changed.
	 *
	 * @param {module:controller/src/InstanceInfo} instance -
	 *     Instance to nodify the config updated.
	 */
	async instanceConfigUpdated(instance) {
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId !== null) {
			let connection = this.wsServer.hostConnections.get(hostId);
			if (connection) {
				await connection.send(
					new lib.InstanceAssignInternalRequest(instance.id, instance.config.serialize("host"))
				);
			}
		}
	}

	addInstanceHooks(instance) {
		instance.config.on("fieldChanged", (group, field, prev) => {
			if (group.name === "instance" && field === "name") {
				this.instanceUpdated(instance);
			}

			lib.invokeHook(this.plugins, "onInstanceConfigFieldChanged", instance, group, field, prev);
		});

		this.instanceUpdated(instance);
	}

	instanceUpdated(instance) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.instanceUpdated(instance);
		}
	}

	saveListUpdate(instanceId, saves) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.saveListUpdate(instanceId, saves);
		}
	}

	modPackUpdated(modPack) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}
			controlConnection.modPackUpdated(modPack);
		}

		lib.invokeHook(this.plugins, "onModPackUpdated", modPack);
	}

	modUpdated(mod) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.modUpdated(mod);
		}

		lib.invokeHook(this.plugins, "onModUpdated", mod);
	}

	userUpdated(user) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.userUpdated(user);
		}
	}

	/**
	 * Notify connected control clients under the given user that the
	 * permissions for this user may have changed.
	 * @param {module:lib.User} user - User permisions updated for.
	 */
	userPermissionsUpdated(user) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.user === user) {
				controlConnection.send(
					new lib.AccountUpdateEvent([...user.roles].map(r => ({
						name: r.name,
						id: r.id,
						permissions: [...r.permissions],
					})))
				);
			}
		}
	}

	/**
	 * Notify connected control clients with the given role that the
	 * permissions may have changed.
	 * @param {module:lib.Role} role - Role permisions updated for.
	 */
	rolePermissionsUpdated(role) {
		for (let controlConnection of this.wsServer.controlConnections.values()) {
			if (controlConnection.user.roles.has(role)) {
				controlConnection.send(
					new lib.AccountUpdateEvent(
						[...controlConnection.user.roles].map(r => ({
							name: r.name,
							id: r.id,
							permissions: [...r.permissions],
						}))
					)
				);
			}
		}
	}

	async loadPlugins() {
		for (let pluginInfo of this.pluginInfos) {
			try {
				let manifestPath = path.posix.join(pluginInfo.requirePath, "dist", "web", "manifest.json");
				pluginInfo.manifest = await Controller.loadJsonObject(require.resolve(manifestPath), true);
			} catch (err) {
				logger.warn(`Unable to load dist/web/manifest.json for plugin ${pluginInfo.name}`);
			}

			if (!this.config.group(pluginInfo.name).get("load_plugin")) {
				continue;
			}

			let ControllerPluginClass = lib.BaseControllerPlugin;
			try {
				if (pluginInfo.controllerEntrypoint) {
					ControllerPluginClass = await lib.loadControllerPluginClass(pluginInfo);
				}

				let controllerPlugin = new ControllerPluginClass(pluginInfo, this, metrics, logger);
				await controllerPlugin.init();
				this.plugins.set(pluginInfo.name, controllerPlugin);

			} catch (err) {
				throw new lib.PluginError(pluginInfo.name, err);
			}

			logger.info(`Loaded plugin ${pluginInfo.name}`);
		}
	}

	/**
	 * Calls listen on server capturing any errors that occurs
	 * binding to the port.  Also adds handler for WebSocket
	 * upgrade event.
	 *
	 * @param {module:net.Server} server - Server to start the listening on.
	 * @param {*} args - Arguments to the .listen() call on the server.
	 * @returns {Promise} promise that resolves the server is listening.
	 */
	listen(server, ...args) {
		return new Promise((resolve, reject) => {
			server.on("upgrade", (req, socket, head) => {
				logger.verbose("handling WebSocket upgrade");
				this.wsServer.handleUpgrade(req, socket, head);
			});

			function wrapError(err) {
				reject(new lib.StartupError(
					`Server listening failed: ${err.message}`
				));
			}

			server.once("error", wrapError);
			server.listen(...args, () => {
				server.off("error", wrapError);
				resolve();
			});
		});
	}


	/**
	 * Returns the URL needed to connect to the controller.
	 *
	 * @returns {string} controller URL.
	 */
	getControllerUrl() {
		return Controller.calculateControllerUrl(this.config);
	}

	static calculateControllerUrl(config) {
		let url = config.get("controller.external_address");
		if (!url) {
			if (config.get("controller.https_port")) {
				url = `https://localhost:${config.get("controller.https_port")}/`;
			} else {
				url = `http://localhost:${config.get("controller.http_port")}/`;
			}
		}
		return url;
	}

	/**
	 * Servers the web interface with the root path set apropriately
	 *
	 * @param {string} route - route the interface is served under.
	 * @returns {function} Experess.js route handler.
	 */
	static serveWeb(route) {
		// The depth is is the number of slashes in the route minus one, but due
		// to lenient matching on trailing slashes in the route we need to
		// compensate if the request path contains a slash but not the route,
		// and vice versa.
		let routeDepth = (route.match(/\//g) || []).length - 1 - (route.slice(-1) === "/");
		return function(req, res, next) {
			let depth = routeDepth + (req.path.slice(-1) === "/");
			let webRoot = "../".repeat(depth) || "./";
			let staticRoot = webRoot;
			let mainBundle;
			if (res.app.locals.mainBundle) {
				mainBundle = res.app.locals.mainBundle;
			} else {
				let stats = res.locals.webpack.devMiddleware.stats.stats[0];
				mainBundle = stats.toJson().assetsByChunkName["main"];
			}
			fs.readFile(path.join(__dirname, "..", "web", "index.html"), "utf8").then((content) => {
				res.type("text/html");
				res.send(content
					.replace(/__CLUSTER_NAME__/g, res.app.locals.controller.config.get("controller.name"))
					.replace(/__WEB_ROOT__/g, webRoot)
					.replace(/__STATIC_ROOT__/g, staticRoot)
					.replace(/__MAIN_BUNDLE__/g, mainBundle)
				);
			}).catch(err => {
				next(err);
			});
		};
	}

	handle(Class, handler) {
		if (Class.type === "request") {
			this.handleRequest(Class, handler);
		} else if (Class.type === "event") {
			this.handleEvent(Class, handler);
		} else {
			throw new Error(`Class ${Class.name} has unrecognized type ${Class.type}`);
		}
	}

	handleRequest(Request, handler) {
		if (!lib.Link._requestsByClass.has(Request)) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._registeredRequests.has(Request)) {
			throw new Error(`Request ${Request.name} is already registered`);
		}
		this._registeredRequests.set(Request, handler);
	}

	fallbackRequest(Request, handler) {
		if (!lib.Link._requestsByClass.has(Request)) {
			throw new Error(`Unregistered Request class ${Request.name}`);
		}
		if (this._fallbackedRequests.has(Request)) {
			throw new Error(`Request ${Request.name} is already fallbacked`);
		}
		this._fallbackedRequests.set(Request, handler);
	}

	handleEvent(Event, handler) {
		if (!lib.Link._eventsByClass.has(Event)) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._registeredEvents.has(Event)) {
			throw new Error(`Event ${Event.name} is already registered`);
		}
		this._registeredEvents.set(Event, handler);
	}

	snoopEvent(Event, handler) {
		if (!lib.Link._eventsByClass.has(Event)) {
			throw new Error(`Unregistered Event class ${Event.name}`);
		}
		if (this._snoopedEvents.has(Event)) {
			throw new Error(`Event ${Event.name} is already snooped`);
		}
		this._snoopedEvents.set(Event, handler);
	}

	/**
	 * Send request or event
	 *
	 * Routes the given request or event to the given destination.  The
	 * destination argument supports address shorthands, see {@link
	 * module:lib.Address.fromShorthand}
	 *
	 * @param {*|module:lib.Address} address - Where to send it.
	 * @param {*} requestOrEvent - The request or event to send.
	 * @returns {Promise<*>|undefined}
	 *     Promise that resolves to the response if a request was sent or
	 *     undefined if it was an event.
	 */
	sendTo(address, requestOrEvent) {
		let dst = lib.Address.fromShorthand(address);
		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequest(requestOrEvent, dst);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEvent(requestOrEvent, dst);
		}
		throw Error(`Unknown type ${requestOrEvent.constructor.type}.`);
	}

	async sendRequest(request, dst) {
		let connection;
		if (dst.type === lib.Address.controller) {
			throw new Error("controller as dst is not supported.");

		} else if (dst.type === lib.Address.control) {
			connection = this.wsServer.controlConnections.get(dst.id);
			if (!connection) {
				throw new lib.RequestError("Target control connection does not exist.");
			}

		} else if (dst.type === lib.Address.instance) {
			let instance = this.getRequestInstance(dst.id);
			let hostId = instance.config.get("instance.assigned_host");
			if (hostId === null) {
				throw new lib.RequestError("Instance is not assigned to a host");
			}
			connection = this.wsServer.hostConnections.get(hostId);
			if (!connection) {
				throw new lib.RequestError("Host containing instance is not connected");
			}

		} else if (dst.type === lib.Address.host) {
			connection = this.wsServer.hostConnections.get(dst.id);
			if (!connection) {
				throw new lib.RequestError("Host is not connected");
			}

		} else {
			throw new Error(`Unknown address type ${dst.type}`);
		}

		return connection.sendRequest(request, dst);
	}

	sendEvent(event, dst) {
		let connection;
		if (dst.type === lib.Address.controller) {
			throw new Error("controller as dst is not supported.");

		} else if (dst.type === lib.Address.control) {
			connection = this.wsServer.controlConnections.get(dst.id);

		} else if (dst.type === lib.Address.instance) {
			let instance = this.instances.get(dst.id);
			if (!instance) {
				return;
			}
			let hostId = instance.config.get("instance.assigned_host");
			if (hostId === null) {
				return;
			}
			connection = this.wsServer.hostConnections.get(hostId);

		} else if (dst.type === lib.Address.host) {
			connection = this.wsServer.hostConnections.get(dst.id);

		} else if (dst.type === lib.Address.broadcast) {
			if (dst.id === lib.Address.control) {
				for (let controlConnection of this.wsServer.controlConnections.values()) {
					controlConnection.sendEvent(event, dst);
				}

			} else if (dst.id === lib.Address.instance || dst.id === lib.Address.host) {
				for (let hostConnection of this.wsServer.hostConnections.values()) {
					hostConnection.sendEvent(event, dst);
				}

			} else {
				throw new Error(`Unexpected broacdast target ${dst.id}`);
			}
			return;

		} else {
			throw new Error(`Unknown address type ${dst.type}`);
		}

		if (connection) {
			connection.sendEvent(event, dst);
		}
	}

	sendToHostByInstanceId(requestOrEvent) {
		if (requestOrEvent.constructor.type === "request") {
			return this.sendRequestToHostByInstanceId(requestOrEvent);
		}
		if (requestOrEvent.constructor.type === "event") {
			return this.sendEventToHostByInstanceId(requestOrEvent);
		}
		throw Error(`Unknown type ${requestOrEvent.constructor.type}.`);
	}

	async sendRequestToHostByInstanceId(request) {
		let instance = this.getRequestInstance(request.instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId === null) {
			throw new lib.RequestError("Instance is not assigned to a host");
		}
		let connection = this.wsServer.hostConnections.get(hostId);
		if (!connection) {
			throw new lib.RequestError("Host containing instance is not connected");
		}
		return await connection.send(request);
	}

	sendEventToHostByInstanceId(event) {
		let instance = this.getRequestInstance(event.instanceId);
		let hostId = instance.config.get("instance.assigned_host");
		if (hostId === null) {
			return;
		}
		let connection = this.wsServer.hostConnections.get(hostId);
		if (!connection) {
			return;
		}
		connection.send(event);
	}
}

module.exports = Controller;
