#!/usr/bin/env node

/**
 * Clusterio master server
 *
 * Facilitates communication between slaves and control of the cluster
 * through WebSocet connections, and hosts a webserver for browser
 * interfaces and Prometheus statistics export.  It is remotely controlled
 * by {@link module:ctl/ctl}.
 *
 * @module master/master
 * @author Danielv123, Hornwitser
 * @example
 * npx clusteriomaster run
 */

// Attempt updating
// const updater = require("./updater");
// updater.update().then(console.log);

"use strict";
const path = require("path");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const setBlocking = require("set-blocking");
const events = require("events");
const yargs = require("yargs");
const WebSocket = require("ws");
const JSZip = require("jszip");
const version = require("./package").version;
const util = require("util");
const winston = require("winston");
const http = require("http");
const https = require("https");

// ugly globals
let masterConfig;
let masterConfigPath;
let masterPlugins = new Map();
let pluginInfos = new Map();
let stopAcceptingNewSessions = false;
let debugEvents = new events.EventEmitter();
let loadedPlugins = {};
let devMiddleware;
let clusterLogger;
let db = {
	instances: new Map(),
	slaves: new Map(),
};
let slaveConnections = new Map();
let controlConnections = [];
let activeConnectors = new Map();
let pendingSockets = new Set();

// homebrew modules
const HttpCloser = require("./src/HttpCloser");
const routes = require("./src/routes");
const libDatabase = require("@clusterio/lib/database");
const libSchema = require("@clusterio/lib/schema");
const libLink = require("@clusterio/lib/link");
const libErrors = require("@clusterio/lib/errors");
const libPlugin = require("@clusterio/lib/plugin");
const libPluginLoader = require("@clusterio/lib/plugin_loader");
const libPrometheus = require("@clusterio/lib/prometheus");
const libConfig = require("@clusterio/lib/config");
const libUsers = require("@clusterio/lib/users");
const libSharedCommands = require("@clusterio/lib/shared_commands");
const libHelpers = require("@clusterio/lib/helpers");
const { ConsoleTransport, levels, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");

const express = require("express");
const compression = require("compression");
const cookieParser = require("cookie-parser");
// Required for express post requests
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const app = express();
let httpServer;
let httpServerCloser;
let httpsServer;
let httpsServerCloser;

app.use(cookieParser());
app.use(bodyParser.json({
	limit: "10mb",
}));
app.use(bodyParser.urlencoded({
	parameterLimit: 100000,
	limit: "10mb",
	extended: true,
}));
app.use(fileUpload());
app.use(compression());


// Servers the web interface with the root path set apropriately.
function serveWeb(route) {
	// The depth is is the number of slashes in the route minus one, but due
	// to lenient matching on trailing slashes in the route we need to
	// compensate if the request path contains a slash but not the route,
	// and vice versa.
	let routeDepth = (route.match(/\//g) || []).length - 1 - (route.slice(-1) === "/");
	return function(req, res, next) {
		let depth = routeDepth + (req.path.slice(-1) === "/");
		let webRoot = "../".repeat(depth) || "./";
		fs.readFile(path.join(__dirname, "web", "index.html"), "utf8").then((content) => {
			res.type("text/html");
			res.send(content.replace(/__WEB_ROOT__/g, webRoot));
		}).catch(err => {
			next(err);
		});
	};
}

// Set folder to serve static content from (the website)
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static("static")); // Used for data export files

const slaveMappingGauge = new libPrometheus.Gauge(
	"clusterio_master_slave_mapping",
	"Mapping of Slave ID to name",
	{
		labels: ["slave_id", "slave_name"],
		callback: function() {
			slaveMappingGauge.clear();
			for (let [id, slave] of db.slaves) {
				slaveMappingGauge.labels({
					slave_id: String(id),
					slave_name: slave.name,
				}).set(1);
			};
		},
	}
);

const instanceMappingGauge = new libPrometheus.Gauge(
	"clusterio_master_instance_mapping",
	"Mapping of Instance ID to name and slave",
	{
		labels: ["instance_id", "instance_name", "slave_id"],
		callback: function() {
			instanceMappingGauge.clear();
			for (let [id, instance] of db.instances) {
				instanceMappingGauge.labels({
					instance_id: String(id),
					instance_name: String(instance.config.get("instance.name")),
					slave_id: String(instance.config.get("instance.assigned_slave")),
				}).set(1);
			}
		},
	}
);

const endpointHitCounter = new libPrometheus.Counter(
	"clusterio_master_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"] }
);

const wsMessageCounter = new libPrometheus.Counter(
	"clusterio_master_websocket_message_total",
	"How many messages have been received over WebSocket on the master server",
	{ labels: ["direction"] }
);

const wsConnectionsCounter = new libPrometheus.Counter(
	"clusterio_master_websocket_connections_total",
	"How many WebSocket connections have been initiated on the master server"
);

const wsRejectedConnectionsCounter = new libPrometheus.Counter(
	"clusterio_master_websocket_rejected_connections_total",
	"How many WebSocket connections have been rejected during the handshake on the master server"
);

const wsActiveConnectionsGauge = new libPrometheus.Gauge(
	"clusterio_master_websocket_active_connections",
	"How many WebSocket connections are currently open to the master server"
);

const wsActiveSlavesGauge = new libPrometheus.Gauge(
	"clusterio_master_active_slaves",
	"How many slaves are currently connected to the master"
);

// Merges samples from sourceResult to destinationResult
function mergeSamples(destinationResult, sourceResult) {
	// Merge metrics received by multiple slaves
	let receivedSamples = new Map(sourceResult.samples);
	for (let [suffix, suffixSamples] of destinationResult.samples) {
		if (receivedSamples.has(suffix)) {
			suffixSamples.push(...receivedSamples.get(suffix));
			receivedSamples.delete(suffix);
		}
	}

	for (let entry of receivedSamples) {
		sourceResult.samples.push(entry);
	}
}

// Prometheus polling endpoint
async function getMetrics(req, res, next) {
	endpointHitCounter.labels(req.route.path).inc();

	let results = [];
	let pluginResults = await libPlugin.invokeHook(masterPlugins, "onMetrics");
	for (let metricIterator of pluginResults) {
		for await (let metric of metricIterator) {
			results.push(metric);
		}
	}

	let requests = [];
	let timeout = masterConfig.get("master.metrics_timeout") * 1000;
	for (let slaveConnection of slaveConnections.values()) {
		requests.push(libHelpers.timeout(libLink.messages.getMetrics.send(slaveConnection), timeout, null));
	}

	for await (let result of await libPrometheus.defaultRegistry.collect()) {
		results.push(result);
	}

	let resultMap = new Map();
	for (let response of await Promise.all(requests)) {
		if (!response) {
			// TODO: Log timeout occured?
			continue;
		}

		for (let result of response.results) {
			if (!resultMap.has(result.metric.name)) {
				resultMap.set(result.metric.name, result);

			} else {
				// Merge metrics received by multiple slaves
				mergeSamples(resultMap.get(result.metric.name), result);
			}
		}
	}

	for (let result of resultMap.values()) {
		results.push(libPrometheus.deserializeResult(result));
	}

	wsActiveConnectionsGauge.set(activeConnectors.size);
	wsActiveSlavesGauge.set(slaveConnections.size);


	let text = await libPrometheus.exposition(results);
	res.set("Content-Type", libPrometheus.exposition.contentType);
	res.send(text);
}
app.get("/metrics", (req, res, next) => getMetrics(req, res, next).catch(next));


function validateSlaveToken(req, res, next) {
	let token = req.header("x-access-token");
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		jwt.verify(token, masterConfig.get("master.auth_secret"), { audience: "slave" });

	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

app.get("/api/plugins", (req, res) => {
	let plugins = [];
	for (let pluginInfo of pluginInfos) {
		let name = pluginInfo.name;
		let enabled = masterPlugins.has(name) && masterConfig.group(name).get("enabled");
		plugins.push({ name, enabled });
	}
	res.send(plugins);
});

// Handle an uploaded export package.
async function uploadExport(req, res, next) {
	endpointHitCounter.labels(req.route.path).inc();
	if (req.get("Content-Type") !== "application/zip") {
		res.sendStatus(415);
		return;
	}

	let data = [];
	for await (let chunk of req) {
		data.push(chunk);
	}
	data = Buffer.concat(data);
	let zip = await JSZip.loadAsync(data);
	data = null;

	// This is hardcoded to prevent path expansion attacks
	let exportFiles = [
		"export/item-spritesheet.png",
		"export/item-metadata.json",
		"export/locale.json",
	];

	for (let filePath of exportFiles) {
		let file = zip.file(filePath);
		if (!file) {
			continue;
		}

		let name = path.posix.basename(filePath);
		await fs.outputFile(path.join("static", "export", name), await file.async("nodebuffer"));
	}

	res.sendStatus(200);
}
app.put("/api/upload-export",
	validateSlaveToken,
	(req, res, next) => uploadExport(req, res, next).catch(next)
);

const masterConnectedClientsCount = new libPrometheus.Gauge(
	"clusterio_master_connected_clients_count", "How many clients are currently connected to this master server",
	{
		labels: ["type"], callback: async function(gauge) {
			gauge.labels("slave").set(slaveConnections.size);
			gauge.labels("control").set(controlConnections.length);
		},
	},
);

/**
 * Returns the URL needed to connect to the master server.
 *
 * @returns {string} master URL.
 */
function getMasterUrl() {
	let url = masterConfig.get("master.external_address");
	if (!url) {
		if (masterConfig.get("master.https_port")) {
			url = `https://localhost:${masterConfig.get("master.https_port")}/`;
		} else {
			url = `http://localhost:${masterConfig.get("master.http_port")}/`;
		}
	}
	return url;
}

/**
 * Load Map from JSON file in the database directory.
 *
 * @param {string} databaseDirectory - Path to master database directory.
 * @param {string} file - Name of file to load.
 * @returns {Map} file loaded as a map.
 */
async function loadMap(databaseDirectory, file) {
	let databasePath = path.resolve(databaseDirectory, file);
	logger.info(`Loading ${databasePath}`);
	return await libDatabase.loadJsonArrayAsMap(databasePath);
}

async function loadInstances(databaseDirectory, file) {
	let filePath = path.join(databaseDirectory, file);
	logger.info(`Loading ${filePath}`);

	let instances = new Map();
	try {
		let serialized = JSON.parse(await fs.readFile(filePath));
		for (let serializedConfig of serialized) {
			let instanceConfig = new libConfig.InstanceConfig();
			await instanceConfig.load(serializedConfig);
			let status = instanceConfig.get("instance.assigned_slave") === null ? "unassigned" : "unknown";
			instances.set(instanceConfig.get("instance.id"), { config: instanceConfig, status });
		}

	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}
	}

	return instances;
}

async function loadUsers(databaseDirectory, file) {
	let loadedRoles = new Map();
	let loadedUsers = new Map();
	try {
		let content = JSON.parse(await fs.readFile(path.join(databaseDirectory, file)));
		for (let serializedRole of content.roles) {
			let role = new libUsers.Role(serializedRole);
			loadedRoles.set(role.id, role);
		}

		for (let serializedUser of content.users) {
			let user = new libUsers.User(serializedUser, loadedRoles);
			loadedUsers.set(user.name, user);
		}

	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}

		// Create default roles if loading failed
		libUsers.ensureDefaultAdminRole(loadedRoles);
		libUsers.ensureDefaultPlayerRole(loadedRoles);
	}

	db.roles = loadedRoles;
	db.users = loadedUsers;
}

/**
 * Create a new user
 *
 * Creates a new user instances and add it to the user database.
 *
 * @param {string} name - Name of the user to create.
 * @returns {module:lib/users.User} newly created user.
 */
function createUser(name) {
	if (db.users.has(name)) {
		throw new Error(`User '${name}' already exists`);
	}

	let defaultRoleId = masterConfig.get("master.default_role_id");
	let user = new libUsers.User({ name, roles: [defaultRoleId] }, db.roles);
	db.users.set(name, user);
	return user;
}

/**
 * Save Map to JSON file in the database directory.
 *
 * @param {string} databaseDirectory - Path to master database directory.
 * @param {string} file - Name of file to save.
 * @param {Map} map - Mapping to save into file.
 */
async function saveMap(databaseDirectory, file, map) {
	let databasePath = path.resolve(databaseDirectory, file);
	logger.info(`Saving ${databasePath}`);
	await libDatabase.saveMapAsJsonArray(databasePath, map);
}

async function saveInstances(databaseDirectory, file, instances) {
	let filePath = path.join(databaseDirectory, file);
	let serialized = [];
	for (let instance of instances.values()) {
		serialized.push(instance.config.serialize());
	}

	await fs.outputFile(filePath, JSON.stringify(serialized, null, 4));
}

async function saveUsers(databaseDirectory, file) {
	let filePath = path.join(databaseDirectory, file);
	let serializedRoles = [];
	for (let role of db.roles.values()) {
		serializedRoles.push(role.serialize());
	}

	let serializedUsers = [];
	for (let user of db.users.values()) {
		serializedUsers.push(user.serialize());
	}

	let serialized = {
		users: serializedUsers,
		roles: serializedRoles,
	};
	await fs.outputFile(filePath, JSON.stringify(serialized, null, 4));
}

/**
 * Innitiate shutdown of master server
 */
async function shutdown() {
	logger.info("Shutting down");
	let exitStartTime = Date.now();
	try {
		logger.info("Saving configs");
		await fs.outputFile(masterConfigPath, JSON.stringify(masterConfig.serialize(), null, 4));

		await saveMap(masterConfig.get("master.database_directory"), "slaves.json", db.slaves);
		await saveInstances(masterConfig.get("master.database_directory"), "instances.json", db.instances);
		await saveUsers(masterConfig.get("master.database_directory"), "users.json");

		await libPlugin.invokeHook(masterPlugins, "onShutdown");

		stopAcceptingNewSessions = true;

		if (devMiddleware) {
			await new Promise((resolve, reject) => { devMiddleware.close(resolve); });
		}

		let disconnectTasks = [];
		for (let controlConnection of controlConnections) {
			controlConnection.connector.setTimeout(masterConfig.get("master.connector_shutdown_timeout"));
			disconnectTasks.push(controlConnection.disconnect(1001, "Server Quit"));
		}

		for (let slaveConnection of slaveConnections.values()) {
			slaveConnection.connector.setTimeout(masterConfig.get("master.connector_shutdown_timeout"));
			disconnectTasks.push(slaveConnection.disconnect(1001, "Server Quit"));
		}

		logger.info(`Waiting for ${disconnectTasks.length} connectors to close`);
		for (let task of disconnectTasks) {
			try {
				await task;
			} catch (err) {
				if (!(err instanceof libErrors.SessionLost)) {
					logger.warn(`Unexpected error disconnecting connector:\n${err.stack}`);
				}
			}
		}

		for (let socket of pendingSockets) {
			socket.close(1001, "Server Quit");
		}

		let stopTasks = [];
		logger.info("Stopping HTTP(S) server");
		if (httpServer) { stopTasks.push(httpServerCloser.close()); }
		if (httpsServer) { stopTasks.push(httpsServerCloser.close()); }
		await Promise.all(stopTasks);

		logger.info(`Clusterio cleanly exited in ${Date.now() - exitStartTime}ms`);

	} catch (err) {
		setBlocking(true);
		logger.fatal(`
+--------------------------------------------------------------------+
| Unexpected error occured while shutting down master, please report |
| it to https://github.com/clusterio/factorioClusterio/issues        |
+--------------------------------------------------------------------+
${err.stack}`
		);
		// eslint-disable-next-line no-process-exit
		process.exit(1);
	}
}

/**
 * Base class for master server connections
 *
 * @extends module:lib/link.Link
 */
class BaseConnection extends libLink.Link {
	constructor(target, connector) {
		super("master", target, connector);
		libLink.attachAllMessages(this);
		for (let masterPlugin of masterPlugins.values()) {
			libPlugin.attachPluginMessages(this, masterPlugin.info, masterPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) {
			throw new libErrors.RequestError("Instance is not assigned to a slave");
		}

		let connection = slaveConnections.get(slaveId);
		if (!connection) {
			throw new libErrors.RequestError("Slave containing instance is not connected");
		}
		if (request.plugin && !connection.plugins.has(request.plugin)) {
			throw new libErrors.RequestError(`Slave containing instance does not have ${request.plugin} plugin`);
		}

		return await request.send(connection, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) { return; }

		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) { return; }

		let connection = slaveConnections.get(slaveId);
		if (!connection || connection.closing) { return; }
		if (event.plugin && !connection.plugins.has(event.plugin)) { return; }

		event.send(connection, message.data);
	}

	async broadcastEventToSlaves(message, event) {
		for (let slaveConnection of slaveConnections.values()) {
			// Do not broadcast back to the source
			if (slaveConnection === this) { continue; }
			if (slaveConnection.connector.closing) { continue; }
			if (event.plugin && !slaveConnection.plugins.has(event.plugin)) { continue; }

			event.send(slaveConnection, message.data);
		}
	}

	async broadcastEventToInstance(message, event) {
		await this.broadcastEventToSlaves(message, event);
	}

	async prepareDisconnectRequestHandler(message, request) {
		await libPlugin.invokeHook(masterPlugins, "onPrepareSlaveDisconnect", this);
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async disconnect(code, reason) {
		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				logger.error(`"Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		await this.connector.close(code, reason);
	}
}

const lastQueryLogTime = new libPrometheus.Gauge(
	"clusterio_master_last_query_log_duration_seconds",
	"Time in seconds the last log query took to execute."
);

class ControlConnection extends BaseConnection {
	constructor(registerData, connector, user) {
		super("control", connector);

		this._agent = registerData.agent;
		this._version = registerData.version;

		/**
		 * The user making this connection.
		 * @type {module:lib/user.User}
		 */
		this.user = user;

		this.connector.on("close", () => {
			let index = controlConnections.indexOf(this);
			if (index !== -1) {
				controlConnections.splice(index, 1);
			}
		});

		this.logTransport = null;
		this.logSubscriptions = {
			all: false,
			master: false,
			slave_ids: [],
			instance_ids: [],
		};

		this.ws_dumper = null;
		this.connector.on("connect", () => {
			this.connector._socket.clusterio_ignore_dump = Boolean(this.ws_dumper);
		});
		this.connector.on("close", () => {
			if (this.logTransport) {
				this.logTransport = null;
				logger.remove(this.logTransport);
			}
			if (this.ws_dumper) {
				debugEvents.off("message", this.ws_dumper);
			}
		});
	}

	async listSlavesRequestHandler(message) {
		let list = [];
		for (let slave of db.slaves.values()) {
			list.push({
				agent: slave.agent,
				version: slave.version,
				id: slave.id,
				name: slave.name,
				connected: slaveConnections.has(slave.id),
			});
		}
		return { list };
	}

	generateSlaveToken(slaveId) {
		return jwt.sign({ aud: "slave", slave: slaveId }, masterConfig.get("master.auth_secret"));
	}

	async generateSlaveTokenRequestHandler(message) {
		return { token: this.generateSlaveToken(message.data.slave_id) };
	}

	async createSlaveConfigRequestHandler(message) {
		let slaveConfig = new libConfig.SlaveConfig();
		await slaveConfig.init();

		slaveConfig.set("slave.master_url", getMasterUrl());
		if (message.data.id !== null) {
			slaveConfig.set("slave.id", message.data.id);
		}
		if (message.data.name !== null) {
			slaveConfig.set("slave.name", message.data.name);
		}
		if (message.data.generate_token) {
			this.user.checkPermission("core.slave.generate_token");
			slaveConfig.set("slave.master_token", this.generateSlaveToken(slaveConfig.get("slave.id")));
		}
		return { serialized_config: slaveConfig.serialize() };
	}

	async listInstancesRequestHandler(message) {
		let list = [];
		for (let instance of db.instances.values()) {
			list.push({
				id: instance.config.get("instance.id"),
				name: instance.config.get("instance.name"),
				assigned_slave: instance.config.get("instance.assigned_slave"),
				status: instance.status,
			});
		}
		return { list };
	}

	// XXX should probably add a hook for slave reuqests?
	async createInstanceRequestHandler(message) {
		let instanceConfig = new libConfig.InstanceConfig();
		await instanceConfig.load(message.data.serialized_config);

		let instanceId = instanceConfig.get("instance.id");
		if (db.instances.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} already exists`);
		}
		db.instances.set(instanceId, { config: instanceConfig, status: "unassigned" });
	}

	async deleteInstanceRequestHandler(message, request) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		if (instance.config.get("instance.assigned_slave") !== null) {
			await this.forwardRequestToInstance(message, request);
		}
		db.instances.delete(message.data.instance_id);
	}

	async getInstanceConfigRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		return {
			serialized_config: instance.config.serialize(),
		};
	}

	async updateInstanceConfig(instance) {
		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId) {
			let connection = slaveConnections.get(slaveId);
			if (connection) {
				await libLink.messages.assignInstance.send(connection, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize(),
				});
			}
		}
	}

	async setInstanceConfigFieldRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		if (message.data.field === "instance.assigned_slave") {
			throw new libErrors.RequestError("instance.assigned_slave must be set through the assign-slave interface");
		}

		if (message.data.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new libErrors.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(message.data.field, message.data.value);
		await this.updateInstanceConfig(instance);
	}

	async setInstanceConfigPropRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let { field, prop, value } = message.data;
		instance.config.setProp(field, prop, value);
		await this.updateInstanceConfig(instance);
	}

	async assignInstanceCommandRequestHandler(message, request) {
		let { slave_id, instance_id } = message.data;
		let instance = db.instances.get(instance_id);
		if (!instance) {
			throw new libErrors.RequestError(`Instance with ID ${instance_id} does not exist`);
		}

		// Check if target slave is connected
		let newSlaveConnection;
		if (slave_id !== null) {
			newSlaveConnection = slaveConnections.get(slave_id);
			if (!newSlaveConnection) {
				// The case of the slave not getting the assign instance message
				// still have to be handled, so it's not a requirement that the
				// target slave be connected to the master while doing the
				// assignment, but it is IMHO a better user experience if this
				// is the case.
				throw new libErrors.RequestError("Target slave is not connected to the master server");
			}
		}

		// Unassign from currently assigned slave if it is connected.
		let currentAssignedSlave = instance.config.get("instance.assigned_slave");
		if (currentAssignedSlave !== null && slave_id !== currentAssignedSlave) {
			let oldSlaveConnection = slaveConnections.get(currentAssignedSlave);
			if (oldSlaveConnection && !oldSlaveConnection.connector.closing) {
				await libLink.messages.unassignInstance.send(oldSlaveConnection, { instance_id });
			}
		}

		// Assign to target
		instance.config.set("instance.assigned_slave", slave_id);
		if (slave_id !== null) {
			await libLink.messages.assignInstance.send(newSlaveConnection, {
				instance_id,
				serialized_config: instance.config.serialize(),
			});
		}
	}

	async setLogSubscriptionsRequestHandler(message) {
		this.logSubscriptions = message.data;
		this.updateLogSubscriptions();
	}

	static logFilter({ all, master, slave_ids, instance_ids, max_level }) {
		return info => {
			// Note: reversed to filter out undefined levels
			if (max_level && !(levels[info.level] <= levels[max_level])) {
				return false;
			}

			if (all) {
				return true;
			}
			if (master && info.slave_id === undefined) {
				return true;
			}
			if (info.slave_id && slave_ids.includes(info.slave_id)) {
				return true;
			}
			if (info.instance_id && instance_ids.includes(info.instance_id)) {
				return true;
			}
			return false;
		};
	}

	updateLogSubscriptions() {
		let { all, master, slave_ids, instance_ids } = this.logSubscriptions;
		if (all || master || slave_ids.length || instance_ids.length) {
			if (!this.logTransport) {
				this.logTransport = new libLoggingUtils.LinkTransport({ link: this });
				clusterLogger.add(this.logTransport);
			}
			this.logTransport.filter = this.constructor.logFilter(this.logSubscriptions);

		} else if (this.logTransport) {
			clusterLogger.remove(this.logTransport);
			this.logTransport = null;
		}
	}

	async queryLogRequestHandler(message) {
		let transport = new winston.transports.File({ filename: "cluster.log" });
		let query = util.promisify((options, callback) => transport.query(options, callback));

		// Available options and defaults inferred from reading the source
		// rows: number = limit || 10
		// limit: number // alias of rows.
		// start: number = 0
		// until: Date = now
		// from: Date = until - 24h
		// order: "asc"|"desc" = "desc"
		// fields: Array<string>
		// level: string
		// This interface is junk:
		// - The level option filters by exact match
		// - No way to add your own filter
		// - No way to stream results
		// - The log file is read starting from the beginning
		let setDuration = lastQueryLogTime.startTimer();
		let log = await query({
			order: "asc",
			limit: Infinity,
			from: new Date(0),
		});

		log = log.filter(this.constructor.logFilter(message.data));
		setDuration();
		return { log };
	}

	async listPermissionsRequestHandler(message) {
		let list = [];
		for (let permission of libUsers.permissions.values()) {
			list.push({
				name: permission.name,
				title: permission.title,
				description: permission.description,
			});
		}
		return { list };
	}

	async listRolesRequestHandler(message) {
		let list = [];
		for (let role of db.roles.values()) {
			list.push({
				id: role.id,
				name: role.name,
				description: role.description,
				permissions: [...role.permissions],
			});
		}
		return { list };
	}

	async createRoleRequestHandler(message) {
		let lastId = Math.max.apply(null, [...db.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		db.roles.set(id, new libUsers.Role({ id, ...message.data }));
		return { id };
	}

	async updateRoleRequestHandler(message) {
		let { id, name, description, permissions } = message.data;
		let role = db.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
	}

	async grantDefaultRolePermissionsRequestHandler(message) {
		let role = db.roles.get(message.data.id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${message.data.id} does not exist`);
		}

		role.grantDefaultPermissions();
	}

	async deleteRoleRequestHandler(message) {
		let id = message.data.id;
		let role = db.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		db.roles.delete(id);
		for (let user of db.users.values()) {
			user.roles.delete(role);
		}
	}

	async listUsersRequestHandler(message) {
		let list = [];
		for (let user of db.users.values()) {
			list.push({
				name: user.name,
				roles: [...user.roles].map(role => role.id),
				is_admin: user.isAdmin,
				is_banned: user.isBanned,
				is_whitelisted: user.isWhitelisted,
				instances: [...user.instances],
			});
		}
		return { list };
	}

	async createUserRequestHandler(message) {
		createUser(message.data.name);
	}

	async updateUserRolesRequestHandler(message) {
		let user = db.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		let resolvedRoles = new Set();
		for (let roleId of message.data.roles) {
			let role = db.roles.get(roleId);
			if (!role) {
				throw new libErrors.RequestError(`Role with ID ${roleId} does not exist`);
			}

			resolvedRoles.add(role);
		}

		user.roles = resolvedRoles;
	}

	async setUserAdminRequestHandler(message) {
		let { name, create, admin } = message.data;
		let user = db.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isAdmin = admin;
		this.broadcastEventToSlaves({ data: { name, admin }}, libLink.messages.adminlistUpdate);
	}

	async setUserBannedRequestHandler(message) {
		let { name, create, banned, reason } = message.data;
		let user = db.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isBanned = banned;
		user.banReason = reason;
		this.broadcastEventToSlaves({ data: { name, banned, reason }}, libLink.messages.banlistUpdate);
	}

	async setUserWhitelistedRequestHandler(message) {
		let { name, create, whitelisted } = message.data;
		let user = db.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isWhitelisted = whitelisted;
		this.broadcastEventToSlaves({ data: { name, whitelisted }}, libLink.messages.whitelistUpdate);
	}

	async deleteUserRequestHandler(message) {
		let user = db.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		if (user.is_admin) {
			this.broadcastEventToSlaves({ data: { name, admin: false }}, libLink.messages.adminlistUpdate);
		}
		if (user.is_whitelisted) {
			this.broadcastEventToSlaves({ data: { name, whitelisted: false }}, libLink.messages.whitelistUpdate);
		}
		if (user.is_banned) {
			this.broadcastEventToSlaves({ data: { name, banned: false, reason: "" }}, libLink.messages.banlistUpdate);
		}
		db.users.delete(message.data.name);
	}

	async debugDumpWsRequestHandler(message) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				libLink.messages.debugWsMessage.send(this, data);
			}
		};
		this.connector._socket.clusterio_ignore_dump = true;
		debugEvents.on("message", this.ws_dumper);
	}
}

/**
 * Represents the connection to a slave
 *
 * @extends module:master~BaseConnection
 */
class SlaveConnection extends BaseConnection {
	constructor(registerData, connector) {
		super("slave", connector);

		this._agent = registerData.agent;
		this._id = registerData.id;
		this._name = registerData.name;
		this._version = registerData.version;
		this.plugins = new Map(Object.entries(registerData.plugins));

		db.slaves.set(this._id, {
			agent: this._agent,
			id: this._id,
			name: this._name,
			version: this._version,
			plugins: registerData.plugins,
		});

		this.connector.on("close", () => {
			if (slaveConnections.get(this._id) === this) {
				slaveConnections.delete(this._id);
			}
		});

		for (let event of ["connect", "drop", "close"]) {
			// eslint-disable-next-line no-loop-func
			this.connector.on(event, () => {
				for (let masterPlugin of masterPlugins.values()) {
					masterPlugin.onSlaveConnectionEvent(this, event);
				}
			});
		}
	}

	async instanceStatusChangedEventHandler(message, event) {
		let instance = db.instances.get(message.data.instance_id);

		// It's possible to get updates from an instance that does not exist
		// or is not assigned to the slave it originated from if it was
		// reassigned or deleted while the connection to the slave it was
		// originally on was down at the time.
		if (!instance || instance.config.get("instance.assigned_slave") !== this._id) {
			logger.warn(`Got bogus update for instance id ${message.data.instance_id}`);
			return;
		}

		let prev = instance.status;
		instance.status = message.data.status;
		logger.verbose(`Instance ${instance.config.get("instance.name")} State: ${instance.status}`);
		await libPlugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
	}

	async updateInstancesRequestHandler(message) {
		// Push updated instance configs
		for (let instance of db.instances.values()) {
			if (instance.config.get("instance.assigned_slave") === this._id) {
				await libLink.messages.assignInstance.send(this, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize(),
				});
			}
		}

		// Assign instances the slave has but master does not
		for (let instance of message.data.instances) {
			let instanceConfig = new libConfig.InstanceConfig();
			await instanceConfig.load(instance.serialized_config);

			let masterInstance = db.instances.get(instanceConfig.get("instance.id"));
			if (masterInstance) {
				// Check if this instance is assigned somewhere else.
				if (masterInstance.config.get("instance.assigned_slave") !== this._id) {
					await libLink.messages.unassignInstance.send(this, {
						instance_id: masterInstance.config.get("instance.id"),
					});
					continue;
				}

				// Already have this instance, update state instead
				if (masterInstance.status !== instance.status) {
					let prev = masterInstance.status;
					masterInstance.status = instance.status;
					logger.verbose(`Instance ${instanceConfig.get("instance.name")} State: ${instance.status}`);
					await libPlugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
				}
				continue;
			}

			instanceConfig.set("instance.assigned_slave", this._id);
			db.instances.set(instanceConfig.get("instance.id"), {
				config: instanceConfig,
				status: instance.status,
			});
			await libLink.messages.assignInstance.send(this, {
				instance_id: instanceConfig.get("instance.id"),
				serialized_config: instanceConfig.serialize(),
			});
		}

		// Push lists to make sure they are in sync.
		let adminlist = [];
		let banlist = [];
		let whitelist = [];

		for (let user of db.users.values()) {
			if (user.isAdmin) {
				adminlist.push(user.name);
			}
			if (user.isBanned) {
				banlist.push([user.name, user.banReason]);
			}
			if (user.isWhitelisted) {
				whitelist.push(user.name);
			}
		}

		libLink.messages.syncUserLists.send(this, { adminlist, banlist, whitelist });
	}

	async logMessageEventHandler(message) {
		clusterLogger.log({
			...message.data.info,
			slave_id: this._id,
			slave_name: this._name,
		});
	}

	async playerEventEventHandler(message) {
		let { instance_id, name, type } = message.data;
		let user = db.users.get(name);
		if (!user) {
			user = createUser(name);
		}

		if (type === "join") {
			user.notifyJoin(instance_id);
		} else if (type === "leave") {
			user.notifyLeave(instance_id);
		}

		let instance = db.instances.get(instance_id);
		await libPlugin.invokeHook(masterPlugins, "onPlayerEvent", instance, message.data);
	}
}

const wss = new WebSocket.Server({
	noServer: true,
	path: "/api/socket",
});

/**
 * Returns true if value is a signed 32-bit integer
 *
 * @param {number} value - value to test.
 * @returns {Boolean}
 *     true if value is an integer between -2<sup>31</sup> and
 *     2<sup>31</sup>-1.
 */
function isInteger(value) {
	return (value | 0) === value;
}


/**
 * Connector for master server connections
 *
 * @extends module:lib/link.WebSocketBaseConnector
 */
class WebSocketServerConnector extends libLink.WebSocketBaseConnector {
	constructor(socket, sessionId) {
		super();

		this._socket = socket;
		this._sessionId = sessionId;

		// The following states are used in the server connector
		// handshake: Waiting for client to (re)connect.
		// connected: Connection is online
		// closing: Connection is in the process of being closed.
		// closed: Connection has been closed
		this._state = "handshake";
		this._connected = false;
		this._timeout = 15 * 60;
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	/**
	 * Send ready over the socket
	 *
	 * Sends the ready message over the socket to initiate the session.
	 *
	 * @param {string} sessionToken -
	 *     the session token to send to the client.
	 */
	ready(sessionToken) {
		this._heartbeatInterval = masterConfig.get("master.heartbeat_interval");
		this._socket.send(JSON.stringify({
			seq: null,
			type: "ready",
			data: {
				session_token: sessionToken,
				heartbeat_interval: this._heartbeatInterval,
			},
		}));

		this._state = "connected";
		this._connected = true;
		this._attachSocketHandlers();
		this.emit("connect");
	}

	/**
	 * Continue connection with the given socket
	 *
	 * Terminates the current socket and contiunes the session over the
	 * socket given from the message sequence given.
	 *
	 * @param {module:net.Socket} socket - New socket to continue on.
	 * @param {number} lastSeq - The last message the client received.
	 */
	continue(socket, lastSeq) {
		this._socket.terminate();
		this._socket = socket;

		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}

		this._heartbeatInterval = masterConfig.get("master.heartbeat_interval");
		this._socket.send(JSON.stringify({
			seq: null,
			type: "continue",
			data: {
				last_seq: this._lastReceivedSeq,
				heartbeat_interval: this._heartbeatInterval,
			},
		}));

		this._state = "connected";
		this._connected = true;
		this._attachSocketHandlers();
		this._dropSendBufferSeq(lastSeq);
		for (let message of this._sendBuffer) {
			this._socket.send(JSON.stringify(message));
		}
		this.emit("connect");
	}

	setTimeout(timeout) {
		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
		}

		this._timeoutId = setTimeout(() => { this._timedOut(); }, timeout * 1000);
		this._timeout = timeout;
	}

	_timedOut() {
		logger.verbose("SOCKET | Connection timed out");
		this._timeoutId = null;
		this._lastReceivedSeq = null;
		this._sendBuffer.length = 0;
		this._state = "closed";
		activeConnectors.delete(this._sessionId);
		this.emit("close");
		this.emit("invalidate");
	}

	_attachSocketHandlers() {
		this.startHeartbeat();

		this._socket.on("close", (code, reason) => {
			logger.verbose(`SOCKET | Close (code: ${code}, reason: ${reason})`);
			if (this._state === "closing") {
				this._lastReceivedSeq = null;
				this._sendBuffer.length = 0;
				this._state = "closed";
				activeConnectors.delete(this._sessionId);

				if (this._connected) {
					this._connected = false;
					this.emit("close");
				}

				if (this._timeoutId) {
					clearTimeout(this._timeoutId);
					this._timeoutId = null;
				}

			} else {
				this._state = "handshake";
				this.emit("drop");
				this._timeoutId = setTimeout(() => { this._timedOut(); }, this._timeout * 1000);
			}

			this.stopHeartbeat();
		});

		this._socket.on("error", err => {
			// It's assumed that close is always called by ws
			logger.verbose("SOCKET | Error:", err);
		});

		this._socket.on("open", () => {
			logger.verbose("SOCKET | Open");
		});
		this._socket.on("ping", data => {
			logger.verbose(`SOCKET | Ping (data: ${data}`);
		});
		this._socket.on("pong", data => {
			logger.verbose(`SOCKET | Pong (data: ${data}`);
		});

		// Handle messages
		this._socket.on("message", data => {
			let message = JSON.parse(data);
			if (["connected", "closing"].includes(this._state)) {
				if (message.seq !== null) {
					this._lastReceivedSeq = message.seq;
				}

				if (message.type === "heartbeat") {
					this._processHeartbeat(message);

				} else {
					this.emit("message", message);
				}

			} else {
				throw new Error(`Received message in unexpected state ${this._state}`);
			}
		});
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close frame and disconnects the connector.
	 *
	 * @param {number} code - WebSocket close code.
	 * @param {string} reason - WebSocket close reason.
	 */
	async close(code, reason) {
		if (this._state === "closed") {
			return;
		}

		this.stopHeartbeat();
		this._state = "closing";
		this._socket.close(code, reason);
		await events.once(this, "close");
	}
}

let nextSessionId = 1;

// Unique string for the session token audience
let masterSession = `session-${Date.now()}`;

// Handle socket handshake
async function handleHandshake(message, socket, req, attachHandler) {
	try {
		message = JSON.parse(message);
	} catch (err) {
		logger.verbose(`SOCKET | closing ${req.socket.remoteAddress} after receiving invalid JSON`);
		wsRejectedConnectionsCounter.inc();
		socket.close(1002, "Invalid JSON");
		return;
	}

	if (!libSchema.clientHandshake(message)) {
		logger.verbose(`SOCKET | closing ${req.socket.remoteAddress} after receiving invalid handshake`);
		wsRejectedConnectionsCounter.inc();
		socket.close(1002, "Bad handshake");
		return;
	}

	let { seq, type, data } = message;

	if (type === "resume") {
		let connector;
		try {
			let payload = jwt.verify(
				data.session_token,
				masterConfig.get("master.auth_secret"),
				{ audience: masterSession }
			);

			connector = activeConnectors.get(payload.sid);
			if (!connector) {
				throw new Error();
			}

		} catch (err) {
			socket.send(JSON.stringify({ seq: null, type: "invalidate", data: {}}));
			attachHandler();
			return;
		}

		connector.continue(socket, data.last_seq);
		return;
	}

	if (stopAcceptingNewSessions) {
		logger.verbose(`SOCKET | closing ${req.socket.remoteAddress}, server is shutting down`);
		wsRejectedConnectionsCounter.inc();
		socket.close(1001, "Shutting down");
		return;
	}

	// Validate token
	let user;
	try {
		if (type === "register_slave") {
			let tokenPayload = jwt.verify(
				data.token,
				masterConfig.get("master.auth_secret"),
				{ audience: "slave" }
			);

			if (tokenPayload.slave !== data.id) {
				throw new Error("missmatched slave id");
			}

		} else if (type === "register_control") {
			let tokenPayload = jwt.verify(
				data.token,
				masterConfig.get("master.auth_secret"),
				{ audience: "user" }
			);

			user = db.users.get(tokenPayload.user);
			if (!user) {
				throw new Error("invalid user");
			}
			if (tokenPayload.iat < user.tokenValidAfter) {
				throw new Error("invalid token");
			}
			user.checkPermission("core.control.connect");
		}

	} catch (err) {
		logger.verbose(`SOCKET | authentication failed for ${req.socket.remoteAddress}`);
		wsRejectedConnectionsCounter.inc();
		socket.close(4003, `Authentication failed: ${err.message}`);
		return;
	}

	let sessionId = nextSessionId;
	nextSessionId += 1;
	let sessionToken = jwt.sign({ aud: masterSession, sid: sessionId }, masterConfig.get("master.auth_secret"));
	let connector = new WebSocketServerConnector(socket, sessionId);
	activeConnectors.set(sessionId, connector);

	if (type === "register_slave") {
		let connection = slaveConnections.get(data.id);
		if (connection) {
			logger.verbose(`SOCKET | disconnecting existing connection for slave ${data.id}`);
			connection.connector.setTimeout(15); // Slave connection is likely stalled
			await connection.disconnect(1008, "Registered from another connection");
		}

		logger.verbose(`SOCKET | registered slave ${data.id} version ${data.version}`);
		slaveConnections.set(data.id, new SlaveConnection(data, connector));

	} else if (type === "register_control") {
		logger.verbose(`SOCKET | registered control from ${req.socket.remoteAddress}`);
		controlConnections.push(new ControlConnection(data, connector, user));
	}

	connector.ready(sessionToken);
}

wss.on("connection", (socket, req) => {
	logger.verbose(`SOCKET | new connection from ${req.socket.remoteAddress}`);

	// Track statistics
	wsConnectionsCounter.inc();
	socket.on("message", (message) => {
		wsMessageCounter.labels("in").inc();
		if (!socket.clusterio_ignore_dump) {
			debugEvents.emit("message", { direction: "in", content: message });
		}
	});
	let originalSend = socket.send;
	socket.send = (...args) => {
		wsMessageCounter.labels("out").inc();
		if (typeof args[0] === "string" && !socket.clusterio_ignore_dump) {
			debugEvents.emit("message", { direction: "out", content: args[0] });
		}
		return originalSend.call(socket, ...args);
	};

	// Start connection handshake.
	socket.send(JSON.stringify({ seq: null, type: "hello", data: {
		version,
		plugins: loadedPlugins,
	}}));

	function attachHandler() {
		pendingSockets.add(socket);

		let timeoutId = setTimeout(() => {
			logger.verbose(`SOCKET | closing ${req.socket.remoteAddress} after timing out on handshake`);
			wsRejectedConnectionsCounter.inc();
			socket.close(1008, "Handshake timeout");
			pendingSockets.delete(socket);
		}, 30*1000);

		socket.once("message", (message) => {
			clearTimeout(timeoutId);
			pendingSockets.delete(socket);
			handleHandshake(
				message, socket, req, attachHandler
			).catch(err => {
				logger.error(`
+----------------------------------------------------------------+
| Unexpected error occured in WebSocket handshake, please report |
| it to https://github.com/clusterio/factorioClusterio/issues    |
+----------------------------------------------------------------+
${err.stack}`
				);
				wsRejectedConnectionsCounter.inc();
				socket.close(1011, "Unexpected error");
			});
		});
	}

	attachHandler();
});

async function loadPlugins() {
	let plugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!masterConfig.group(pluginInfo.name).get("enabled")) {
			continue;
		}

		loadedPlugins[pluginInfo.name] = pluginInfo.version;

		let pluginLoadStarted = Date.now();
		let MasterPluginClass = libPlugin.BaseMasterPlugin;
		try {
			if (pluginInfo.masterEntrypoint) {
				MasterPluginClass = await libPluginLoader.loadMasterPluginClass(pluginInfo);
			}

			let masterPlugin = new MasterPluginClass(
				pluginInfo, { app, config: masterConfig, db, slaveConnections }, { endpointHitCounter }, logger
			);
			await masterPlugin.init();
			plugins.set(pluginInfo.name, masterPlugin);

		} catch (err) {
			throw new libErrors.PluginError(pluginInfo.name, err);
		}

		logger.info(`Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
	}
	return plugins;
}

// handle plugins on the master
async function pluginManagement() {
	let startPluginLoad = Date.now();
	masterPlugins = await loadPlugins();
	logger.info(`All plugins loaded in ${Date.now() - startPluginLoad}ms`);
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
function listen(server, ...args) {
	return new Promise((resolve, reject) => {
		server.on("upgrade", (req, socket, head) => {
			logger.verbose("handling WebSocket upgrade");

			// For reasons that defy common sense, the connection event has
			// to be emitted explictly when using noServer.
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
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

function _setConfig(config) {
	masterConfig = config;
}

async function handleBootstrapCommand(args) {
	let subCommand = args._[1];
	await loadUsers(masterConfig.get("master.database_directory"), "users.json");
	if (subCommand === "create-admin") {
		if (!args.name) {
			logger.error("name cannot be blank");
			process.exitCode = 1;
			return;
		}

		let admin = db.users.get(args.name);
		if (!admin) {
			admin = createUser(args.name);
		}

		let adminRole = libUsers.ensureDefaultAdminRole(db.roles);
		admin.roles.add(adminRole);
		admin.isAdmin = true;
		await saveUsers(masterConfig.get("master.database_directory"), "users.json");

	} else if (subCommand === "generate-user-token") {
		let user = db.users.get(args.name);
		if (!user) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		// eslint-disable-next-line no-console
		console.log(user.createToken(masterConfig.get("master.auth_secret")));

	} else if (subCommand === "create-ctl-config") {
		let admin = db.users.get(args.name);
		if (!admin) {
			logger.error(`No user named '${args.name}'`);
			process.exitCode = 1;
			return;
		}
		let controlConfig = new libConfig.ControlConfig();
		await controlConfig.init();

		controlConfig.set("control.master_url", getMasterUrl());
		controlConfig.set("control.master_token", admin.createToken(masterConfig.get("master.auth_secret")));

		let content = JSON.stringify(controlConfig.serialize(), null, 4);
		if (args.output === "-") {
			// eslint-disable-next-line no-console
			console.log(content);
		} else {
			logger.info(`Writing ${args.output}`);
			await fs.outputFile(args.output, content);
		}
	}
}

async function initialize() {
	// argument parsing
	let args = yargs
		.scriptName("master")
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
			describe: "master config file to use",
			default: "config-master.json",
			type: "string",
		})
		.option("plugin-list", {
			nargs: 1,
			describe: "File containing list of plugins available with their install path",
			default: "plugin-list.json",
			type: "string",
		})
		.command("plugin", "Manage available plugins", libSharedCommands.pluginCommand)
		.command("config", "Manage Master config", libSharedCommands.configCommand)
		.command("bootstrap", "Bootstrap access to cluster", yargs => {
			yargs
				.command("create-admin <name>", "Create a cluster admin")
				.command("generate-user-token <name>", "Generate authentication token for the given user")
				.command("create-ctl-config <name>", "Create clusterioctl config for the given user", yargs => {
					yargs.option("output", {
						describe: "Path to output config (- for stdout)", type: "string",
						nargs: 1, default: "config-control.json",
					});
				})
				.demandCommand(1, "You need to specify a command to run");
		})
		.command("run", "Run master server", yargs => {
			yargs.option("dev", { hidden: true, type: "boolean", nargs: 0 });
		})
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	// Combined log stream of the whole cluster.
	clusterLogger = winston.createLogger({
		format: winston.format.json(),
		level: "verbose",
		levels,
	});
	clusterLogger.add(new winston.transports.File({
		filename: "cluster.log",
	}));

	// Log stream for the master server.
	logger.add(new winston.transports.File({
		format: winston.format.json(),
		filename: "master.log",
	}));
	logger.add(new winston.transports.Stream({
		stream: clusterLogger,
	}));
	if (args.logLevel !== "none") {
		logger.add(new ConsoleTransport({
			level: args.logLevel,
			format: new libLoggingUtils.TerminalFormat(),
		}));
	}

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
		return [false, args];
	}

	logger.info("Loading Plugin info");
	pluginInfos = await libPluginLoader.loadPluginInfos(pluginList);
	libConfig.registerPluginConfigGroups(pluginInfos);
	libConfig.finalizeConfigs();

	masterConfigPath = args.config;
	logger.info(`Loading config from ${masterConfigPath}`);
	masterConfig = new libConfig.MasterConfig();
	try {
		await masterConfig.load(JSON.parse(await fs.readFile(masterConfigPath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("Config not found, initializing new config");
			await masterConfig.init();

		} else {
			throw err;
		}
	}

	if (!masterConfig.get("master.auth_secret")) {
		logger.info("Generating new master authentication secret");
		let asyncRandomBytes = util.promisify(crypto.randomBytes);
		let bytes = await asyncRandomBytes(256);
		masterConfig.set("master.auth_secret", bytes.toString("base64"));
		await fs.outputFile(masterConfigPath, JSON.stringify(masterConfig.serialize(), null, 4));
	}

	if (command === "config") {
		await libSharedCommands.handleConfigCommand(args, masterConfig, masterConfigPath);
		return [false, args];

	} else if (command === "bootstrap") {
		await handleBootstrapCommand(args);
		return [false, args];
	}

	// If we get here the command was run
	return [true, args];
}

async function startServer(args) {
	// Start webpack development server if enabled
	if (args.dev) {
		logger.warn("Webpack development mode enabled");
		/* eslint-disable global-require */
		const webpack = require("webpack");
		const webpackDevMiddleware = require("webpack-dev-middleware");
		const webpackConfig = require("./webpack.config");
		/* eslint-enable global-require */

		const compiler = webpack(webpackConfig({}));
		devMiddleware = webpackDevMiddleware(compiler, {});
		app.use(devMiddleware);
	}

	let secondSigint = false;
	process.on("SIGINT", () => {
		if (secondSigint) {
			logger.fatal("Caught second interrupt, terminating immediately");
			// eslint-disable-next-line no-process-exit
			process.exit(1);
		}

		secondSigint = true;
		logger.info("Caught interrupt signal, shutting down");
		shutdown();
	});

	// terminal closed
	process.on("SIGHUP", () => {
		// No graceful cleanup, no warning out (stdout is likely closed.)
		// Don't close the terminal with the clusterio master in it.
		// eslint-disable-next-line no-process-exit
		process.exit(1);
	});

	await fs.ensureDir(masterConfig.get("master.database_directory"));

	db.slaves = await loadMap(masterConfig.get("master.database_directory"), "slaves.json");
	db.instances = await loadInstances(masterConfig.get("master.database_directory"), "instances.json");
	await loadUsers(masterConfig.get("master.database_directory"), "users.json");

	// Make sure we're actually going to listen on a port
	let httpPort = masterConfig.get("master.http_port");
	let httpsPort = masterConfig.get("master.https_port");
	let bindAddress = masterConfig.get("master.bind_address") || "";
	if (!httpPort && !httpsPort) {
		logger.fatal("Error: at least one of http_port and https_port must be configured");
		process.exitCode = 1;
		return;
	}

	let tls_cert = masterConfig.get("master.tls_certificate");
	let tls_key = masterConfig.get("master.tls_private_key");

	if (httpsPort && (!tls_cert || !tls_key)) {
		throw new libErrors.StartupError(
			"tls_certificate and tls_private_key must be configure in order to use https_port"
		);
	}

	// Add routes for the web interface
	for (let route of routes) {
		app.get(route, serveWeb(route));
	}
	for (let pluginInfo of pluginInfos) {
		for (let route of pluginInfo.routes || []) {
			app.get(route, serveWeb(route));
		}

		let pluginPackagePath = require.resolve(path.posix.join(pluginInfo.requirePath, "package.json"));
		let staticPath = path.join(path.dirname(pluginPackagePath), "static");
		app.use(`/plugin/${pluginInfo.name}`, express.static(staticPath));
	}

	// Load plugins
	await pluginManagement();

	// Only start listening for connections after all plugins have loaded
	if (httpPort) {
		httpServer = http.createServer(app);
		httpServerCloser = new HttpCloser(httpServer);
		await listen(httpServer, httpPort, bindAddress);
		logger.info(`Listening for HTTP on port ${httpServer.address().port}`);
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

		httpsServer = https.createServer({
			key: privateKey,
			cert: certificate,
		}, app);
		httpsServerCloser = new HttpCloser(httpsServer);
		await listen(httpsServer, httpsPort, bindAddress);
		logger.info(`Listening for HTTPS on port ${httpsServer.address().port}`);
	}
}

async function startup() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioMaster";

	// add better stack traces on promise rejection
	process.on("unhandledRejection", err => logger.error(`Unhandled rejection:\n${err.stack}`));

	let [shouldRun, args] = await initialize();
	if (shouldRun) {
		await startServer(args);
	}
}

module.exports = {
	app,

	// For testing only
	_db: db,
	_setConfig,
	_WebSocketServerConnector: WebSocketServerConnector,
	_controlConnections: controlConnections,
	_ControlConnection: ControlConnection,
	_slaveConnections: slaveConnections,
	_SlaveConnection: SlaveConnection,
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
	startup().catch(err => {
		if (err instanceof libErrors.StartupError) {
			logger.fatal(`
+----------------------------------+
| Unable to to start master server |
+----------------------------------+
${err.stack}`
			);
		} else if (err instanceof libErrors.PluginError) {
			logger.fatal(`
${err.pluginName} plugin threw an unexpected error
during startup, please report it to the plugin author.
------------------------------------------------------
${err.original.stack}`
			);
		} else {
			logger.fatal(`
+---------------------------------------------------------------+
| Unexpected error occured while starting master, please report |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+
${err.stack}`
			);
		}

		if (masterConfig) {
			shutdown();
		}
	});
}
