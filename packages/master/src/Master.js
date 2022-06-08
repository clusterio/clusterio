"use strict";
const compression = require("compression");
const events = require("events");
const express = require("express");
const fs = require("fs-extra");
const http = require("http");
const https = require("https");
const path = require("path");


const libConfig = require("@clusterio/lib/config");
const libErrors = require("@clusterio/lib/errors");
const libFileOps = require("@clusterio/lib/file_ops");
const libLink = require("@clusterio/lib/link");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libPrometheus = require("@clusterio/lib/prometheus");
const { logger } = require("@clusterio/lib/logging");

const HttpCloser = require("./HttpCloser");
const metrics = require("./metrics");
const routes = require("./routes");
const UserManager = require("./UserManager");
const WsServer = require("./WsServer");


const hitCounter = new libPrometheus.Counter(
	"clusterio_master_http_hits_total",
	"How many HTTP requests in total have been received"
);

/**
 * Manages all master related operations
 * @alias module:master/src/Master
 */
class Master {
	constructor(clusterLogger, pluginInfos, configPath, config) {
		this.clusterLogger = clusterLogger;
		/**
		 * Mapping of plugin name to info objects for known plugins
		 * @type {Map<string, Object>}
		 */
		this.pluginInfos = pluginInfos;
		this.configPath = configPath;
		/**
		 * Master config.
		 * @type {module:lib/config.MasterConfig}
		 */
		this.config = config;

		this.app = express();
		this.app.locals.master = this;
		this.app.locals.streams = new Map();

		/**
		 * Mapping of slave id to slave info
		 * @type {Map<number, Object>}
		 */
		this.slaves = null;

		/**
		 * Mapping of instance id to instance info
		 * @type {Map<number, Object>}
		 */
		this.instances = null;

		/**
		 * User and roles manager for the cluster
		 * @type {module:master/src/UserManager}
		 */
		this.userManager = null;
		this.httpServer = null;
		this.httpServerCloser = null;
		this.httpsServer = null;
		this.httpsServerCloser = null;

		/**
		 * Mapping of plugin name to loaded plugin
		 * @type {Map<string, module:lib/plugin.BaseMasterPlugin>}
		 */
		this.plugins = new Map();

		/**
		 * WebSocket server
		 * @type {module:master/src/WsServer}
		 */
		this.wsServer = new WsServer(this);

		this.debugEvents = new events.EventEmitter();
		this._events = new events.EventEmitter();
		// Possible states are new, starting, running, stopping, stopped
		this._state = "new";
		this._shouldStop = false;

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

	async _startInternal(args) {
		this.logDirectory = args.logDirectory;
		this.clusterLogIndex = await libLoggingUtils.LogIndex.load(path.join(this.logDirectory, "cluster"));
		this.clusterLogBuildInterval = setInterval(() => {
			this.clusterLogIndex.buildIndex().catch(
				err => logger.error(`Error building cluster log index:\n${err.stack}`)
			);
		}, 600e3);

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
						throw new libErrors.StartupError(`No plugin named ${name}`);
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

		let databaseDirectory = this.config.get("master.database_directory");
		await fs.ensureDir(databaseDirectory);

		this.slaves = await Master.loadSlaves(path.join(databaseDirectory, "slaves.json"));
		this.instances = await Master.loadInstances(path.join(databaseDirectory, "instances.json"));
		this.userManager = new UserManager(this.config);
		await this.userManager.load(path.join(databaseDirectory, "users.json"));

		this.config.on("fieldChanged", (group, field, prev) => {
			libPlugin.invokeHook(this.plugins, "onMasterConfigFieldChanged", group, field, prev);
		});
		for (let instance of this.instances.values()) {
			this.addInstanceHooks(instance);
		}

		// Make sure we're actually going to listen on a port
		let httpPort = this.config.get("master.http_port");
		let httpsPort = this.config.get("master.https_port");
		let bindAddress = this.config.get("master.bind_address") || "";
		if (!httpPort && !httpsPort) {
			logger.fatal("Error: at least one of http_port and https_port must be configured");
			process.exitCode = 1;
			return;
		}

		let tls_cert = this.config.get("master.tls_certificate");
		let tls_key = this.config.get("master.tls_private_key");

		if (httpsPort && (!tls_cert || !tls_key)) {
			throw new libErrors.StartupError(
				"tls_certificate and tls_private_key must be configure in order to use https_port"
			);
		}

		Master.addAppRoutes(this.app, this.pluginInfos);

		if (!args.dev) {
			let manifest = await Master.loadJsonObject(path.join(__dirname, "..", "dist", "web", "manifest.json"));
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
				throw new libErrors.StartupError(
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

		logger.info("Started master");
		this._state = "running";
	}

	/**
	 * Stops the master server.
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
		logger.info("Stopping master");
		clearInterval(this.clusterLogBuildInterval);
		if (this.clusterLogIndex) {
			await this.clusterLogIndex.save();
		}

		logger.info("Saving config");
		await libFileOps.safeOutputFile(this.configPath, JSON.stringify(this.config.serialize(), null, 4));

		if (this.devMiddleware) {
			await new Promise((resolve, reject) => { this.devMiddleware.close(resolve); });
		}

		let databaseDirectory = this.config.get("master.database_directory");
		if (this.slaves) {
			await Master.saveSlaves(path.join(databaseDirectory, "slaves.json"), this.slaves);
		}

		if (this.instances) {
			await Master.saveInstances(path.join(databaseDirectory, "instances.json"), this.instances);
		}

		if (this.userManager) {
			await this.userManager.save(path.join(databaseDirectory, "users.json"));
		}

		await libPlugin.invokeHook(this.plugins, "onShutdown");

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

	static async loadSlaves(filePath) {
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

	static async saveSlaves(filePath, slaves) {
		await libFileOps.safeOutputFile(filePath, JSON.stringify([...slaves.entries()], null, 4));
	}

	static async loadInstances(filePath) {
		logger.info(`Loading ${filePath}`);

		let instances = new Map();
		try {
			let serialized = JSON.parse(await fs.readFile(filePath));
			for (let serializedConfig of serialized) {
				let instanceConfig = new libConfig.InstanceConfig("master");
				await instanceConfig.load(serializedConfig);
				let status = instanceConfig.get("instance.assigned_slave") === null ? "unassigned" : "unknown";
				let instance = { config: instanceConfig, status };
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

		await libFileOps.safeOutputFile(filePath, JSON.stringify(serialized, null, 4));
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

	/**
	 * Query master log
	 *
	 * @param {module:lib/logging_utils~QueryLogFilter} filter -
	 *     Filter to limit entries with. Note that only the master log can
	 *     be queried from this function.
	 * @returns {Array<Object>} log entries matching the filter
	 */
	async queryMasterLog(filter) {
		return await libLoggingUtils.queryLog(
			path.join(this.logDirectory, "master"), filter,
		);
	}

	/**
	 * Query cluster log
	 *
	 * @param {module:lib/logging_utils~QueryLogFilter} filter -
	 *     Filter to limit entries with.
	 * @returns {Array<Object>} log entries matching the filter
	 */
	async queryClusterLog(filter) {
		return await libLoggingUtils.queryLog(
			path.join(this.logDirectory, "cluster"), filter, this.clusterLogIndex,
		);
	}

	static addAppRoutes(app, pluginInfos) {
		app.use((req, res, next) => {
			hitCounter.inc();
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
			app.get(route, Master.serveWeb(route));
		}
		for (let pluginInfo of pluginInfos) {
			for (let route of pluginInfo.routes || []) {
				app.get(route, Master.serveWeb(route));
			}

			let pluginPackagePath = require.resolve(path.posix.join(pluginInfo.requirePath, "package.json"));
			let webPath = path.join(path.dirname(pluginPackagePath), "dist", "web", "static");
			app.use("/static", express.static(webPath, staticOptions));
		}
	}

	slaveUpdated(slave) {
		let update = {
			agent: slave.agent,
			version: slave.version,
			id: slave.id,
			name: slave.name,
			public_address: slave.public_address || null,
			connected: this.wsServer.slaveConnections.has(slave.id),
		};

		for (let controlConnection of this.wsServer.controlConnections) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.slaveUpdated(slave, update);
		}
	}

	/**
	 * Get instance by ID for a request
	 *
	 * @param {number} instanceId - ID of instance to get.
	 * @returns {object} instance
	 * @throws {module:lib/errors.RequestError} if the instance does not exist.
	 */
	getRequestInstance(instanceId) {
		let instance = this.instances.get(instanceId);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}
		return instance;
	}

	addInstanceHooks(instance) {
		instance.config.on("fieldChanged", (group, field, prev) => {
			if (group.name === "instance" && field === "name") {
				this.instanceUpdated(instance);
			}

			libPlugin.invokeHook(this.plugins, "onInstanceConfigFieldChanged", instance, group, field, prev);
		});

		this.instanceUpdated(instance);
	}

	instanceUpdated(instance) {
		for (let controlConnection of this.wsServer.controlConnections) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.instanceUpdated(instance);
		}
	}

	saveListUpdate(data) {
		for (let controlConnection of this.wsServer.controlConnections) {
			if (controlConnection.connector.closing) {
				continue;
			}

			controlConnection.saveListUpdate(data);
		}
	}

	/**
	 * Notify connected control clients under the given user that the
	 * permissions for this user may have changed.
	 * @param {module:lib/users.User} user - User permisions updated for.
	 */
	userPermissionsUpdated(user) {
		for (let controlConnection of this.wsServer.controlConnections) {
			if (controlConnection.user === user) {
				libLink.messages.accountUpdate.send(controlConnection, {
					"roles": [...user.roles].map(r => ({
						name: r.name,
						id: r.id,
						permissions: [...r.permissions],
					})),
				});
			}
		}
	}

	/**
	 * Notify connected control clients with the given role that the
	 * permissions may have changed.
	 * @param {module:lib/users.Role} role - Role permisions updated for.
	 */
	rolePermissionsUpdated(role) {
		for (let controlConnection of this.wsServer.controlConnections) {
			if (controlConnection.user.roles.has(role)) {
				libLink.messages.accountUpdate.send(controlConnection, {
					"roles": [...controlConnection.user.roles].map(r => ({
						name: r.name,
						id: r.id,
						permissions: [...r.permissions],
					})),
				});
			}
		}
	}

	async loadPlugins() {
		for (let pluginInfo of this.pluginInfos) {
			try {
				let manifestPath = path.posix.join(pluginInfo.requirePath, "dist", "web", "manifest.json");
				pluginInfo.manifest = await Master.loadJsonObject(require.resolve(manifestPath), true);
			} catch (err) {
				logger.warn(`Unable to load dist/web/manifest.json for plugin ${pluginInfo.name}`);
			}

			if (!this.config.group(pluginInfo.name).get("load_plugin")) {
				continue;
			}

			let MasterPluginClass = libPlugin.BaseMasterPlugin;
			try {
				if (pluginInfo.masterEntrypoint) {
					MasterPluginClass = await libPluginLoader.loadMasterPluginClass(pluginInfo);
				}

				let masterPlugin = new MasterPluginClass(pluginInfo, this, metrics, logger);
				await masterPlugin.init();
				this.plugins.set(pluginInfo.name, masterPlugin);

			} catch (err) {
				throw new libErrors.PluginError(pluginInfo.name, err);
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
				reject(new libErrors.StartupError(
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
	 * Returns the URL needed to connect to the master server.
	 *
	 * @returns {string} master URL.
	 */
	getMasterUrl() {
		return Master.calculateMasterUrl(this.config);
	}

	static calculateMasterUrl(config) {
		let url = config.get("master.external_address");
		if (!url) {
			if (config.get("master.https_port")) {
				url = `https://localhost:${config.get("master.https_port")}/`;
			} else {
				url = `http://localhost:${config.get("master.http_port")}/`;
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
					.replace(/__CLUSTER_NAME__/g, res.app.locals.master.config.get("master.name"))
					.replace(/__WEB_ROOT__/g, webRoot)
					.replace(/__STATIC_ROOT__/g, staticRoot)
					.replace(/__MAIN_BUNDLE__/g, mainBundle)
				);
			}).catch(err => {
				next(err);
			});
		};
	}

	/**
	 * Forward the given request to the slave contaning the instance
	 *
	 * Finds the slave which the instance with the given instance ID is
	 * currently assigned to and forwards the request to that instance.
	 * The request data must have an instance_id parameter.
	 *
	 * @param {module:lib/link.Request} request - The request to send.
	 * @param {object} data - Data to pass with the request.
	 * @param {number} data.instance_id -
	 *     ID of instance to send this request towards
	 * @returns {object} data returned from the request.
	 */
	async forwardRequestToInstance(request, data) {
		let instance = this.getRequestInstance(data.instance_id);
		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) {
			throw new libErrors.RequestError("Instance is not assigned to a slave");
		}

		let connection = this.wsServer.slaveConnections.get(slaveId);
		if (!connection) {
			throw new libErrors.RequestError("Slave containing instance is not connected");
		}
		if (request.plugin && !connection.plugins.has(request.plugin)) {
			throw new libErrors.RequestError(`Slave containing instance does not have ${request.plugin} plugin`);
		}

		return await request.send(connection, data);
	}
}

module.exports = Master;
