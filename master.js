/**
 * Clusterio master server
 *
 * Facilitates communication between slaves and control of the cluster
 * through WebSocet connections, and hosts a webserver for browser
 * interfaces and Prometheus statistics export.  It is remotely controlled
 * by {@link module:clusterctl}.
 *
 * @module
 * @author Danielv123, Hornwitser
 * @example
 * node master run
 */

// Attempt updating
// const updater = require("./updater");
// updater.update().then(console.log);

"use strict";
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const moment = require("moment");
const request = require("request");
const setBlocking = require("set-blocking");
const events = require("events");
const yargs = require("yargs");
const WebSocket = require("ws");
const JSZip = require("jszip");
const version = require("./package").version;

// ugly globals
let masterConfig;
let masterConfigPath;
let stopAcceptingNewSessions = false;
let debugEvents = new events.EventEmitter();
let pluginList = {};

// homebrew modules
const generateSSLcert = require("lib/generateSSLcert");
const database = require("lib/database");
const schema = require("lib/schema");
const link = require("lib/link");
const errors = require("lib/errors");
const plugin = require("lib/plugin");
const prometheus = require("lib/prometheus");
const config = require("lib/config");
const users = require("lib/users");

const express = require("express");
const compression = require("compression");
const cookieParser = require("cookie-parser");
// Required for express post requests
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
var app = express();
var httpServer;
var httpsServer;

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

// dynamic HTML generations with EJS
app.set("view engine", "ejs");
app.set("views", ["views", "plugins"]);

// give ejs access to some interesting information
app.use(function(req, res, next){
	let externalAddress = masterConfig.get("master.external_address");
	res.locals.root = externalAddress ? new URL(externalAddress).pathname : "/";
	res.locals.res = res;
	res.locals.req = req;
	res.locals.masterPlugins = masterPlugins;
	res.locals.slaves = db.slaves;
	res.locals.moment = moment;
	next();
});

require("./routes")(app);
// Set folder to serve static content from (the website)
app.use(express.static("static"));

const endpointHitCounter = new prometheus.Counter(
	"clusterio_master_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"] }
);

const wsMessageCounter = new prometheus.Counter(
	"clusterio_master_websocket_message_total",
	"How many messages have been received over WebSocket on the master server",
	{ labels: ["direction"] }
);

const wsConnectionsCounter = new prometheus.Counter(
	"clusterio_master_websocket_connections_total",
	"How many WebSocket connections have been initiated on the master server"
);

const wsRejectedConnectionsCounter = new prometheus.Counter(
	"clusterio_master_websocket_rejected_connections_total",
	"How many WebSocket connections have been rejected during the handshake on the master server"
);

const wsActiveConnectionsGauge = new prometheus.Gauge(
	"clusterio_master_websocket_active_connections",
	"How many WebSocket connections are currently open to the master server"
);

const wsActiveSlavesGauge = new prometheus.Gauge(
	"clusterio_master_active_slaves",
	"How many slaves are currently connected to the master"
);

// Prometheus polling endpoint
async function getMetrics(req, res, next) {
	endpointHitCounter.labels(req.route.path).inc();

	let results = [];
	let pluginResults = await plugin.invokeHook(masterPlugins, "onMetrics");
	for (let metricIterator of pluginResults) {
		for await (let metric of metricIterator) {
			results.push(metric);
		}
	}

	let requests = [];
	for (let slaveConnection of slaveConnections.values()) {
		// XXX this needs a timeout
		requests.push(link.messages.getMetrics.send(slaveConnection));
	}

	for await (let result of await prometheus.defaultRegistry.collect()) {
		results.push(result);
	}

	let resultMap = new Map();
	for (let response of await Promise.all(requests)) {
		for (let result of response.results) {
			if (!resultMap.has(result.metric.name)) {
				resultMap.set(result.metric.name, result);

			} else {
				// Merge metrics received by multiple slaves
				let stored = resultMap.get(result.metric.name);
				stored.samples.push(...result.samples);
			}
		}
	}

	for (let result of resultMap.values()) {
		results.push(prometheus.deserializeResult(result));
	}

	wsActiveConnectionsGauge.set(activeConnectors.size);
	wsActiveSlavesGauge.set(slaveConnections.size);


	let text = await prometheus.exposition(results);
	res.set("Content-Type", prometheus.exposition.contentType);
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

const masterConnectedClientsCount = new prometheus.Gauge(
	"clusterio_master_connected_clients_count", "How many clients are currently connected to this master server",
	{
		labels: ["type"], callback: async function(gauge) {
			gauge.labels("slave").set(slaveConnections.size);
			gauge.labels("control").set(controlConnections.length);
		},
	},
);

// set up database
const db = {};

/**
 * Load Map from JSON file in the database directory.
 *
 * @param {string} databaseDirectory - Path to master database directory.
 * @param {string} file - Name of file to load.
 * @returns {Map} file loaded as a map.
 */
async function loadMap(databaseDirectory, file) {
	let databasePath = path.resolve(databaseDirectory, file);
	console.log(`Loading ${databasePath}`);
	return await database.loadJsonArrayAsMap(databasePath);
}

async function loadInstances(databaseDirectory, file) {
	let filePath = path.join(databaseDirectory, file);
	console.log(`Loading ${filePath}`);

	let instances = new Map();
	try {
		let serialized = JSON.parse(await fs.readFile(filePath));
		for (let serializedConfig of serialized) {
			let instanceConfig = new config.InstanceConfig();
			await instanceConfig.load(serializedConfig);
			instances.set(instanceConfig.get("instance.id"), { config: instanceConfig });
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
			let role = new users.Role(serializedRole);
			loadedRoles.set(role.id, role);
		}

		for (let serializedUser of content.users) {
			let user = new users.User(serializedUser, loadedRoles);
			loadedUsers.set(user.name, user);
		}

	} catch (err) {
		if (err.code !== "ENOENT") {
			throw err;
		}

		// Create default roles if loading failed
		users.ensureDefaultAdminRole(loadedRoles);
		users.ensureDefaultPlayerRole(loadedRoles);
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
	let user = new users.User({ name, roles: [defaultRoleId] }, db.roles);
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
	console.log(`Saving ${databasePath}`);
	await database.saveMapAsJsonArray(databasePath, map);
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
	console.log("Shutting down");
	let exitStartTime = Date.now();
	try {
		console.log("Saving configs");
		await fs.outputFile(masterConfigPath, JSON.stringify(masterConfig.serialize(), null, 4));

		await saveMap(masterConfig.get("master.database_directory"), "slaves.json", db.slaves);
		await saveInstances(masterConfig.get("master.database_directory"), "instances.json", db.instances);
		await saveUsers(masterConfig.get("master.database_directory"), "users.json");

		await plugin.invokeHook(masterPlugins, "onShutdown");

		stopAcceptingNewSessions = true;

		let disconnectTasks = [];
		for (let controlConnection of controlConnections) {
			controlConnection.connector.setTimeout(masterConfig.get("master.connector_shutdown_timeout"));
			disconnectTasks.push(controlConnection.disconnect(1001, "Server Quit"));
		}

		for (let slaveConnection of slaveConnections.values()) {
			slaveConnection.connector.setTimeout(masterConfig.get("master.connector_shutdown_timeout"));
			disconnectTasks.push(slaveConnection.disconnect(1001, "Server Quit"));
		}

		console.log(`Waiting for ${disconnectTasks.length} connectors to close`);
		for (let task of disconnectTasks) {
			try {
				await task;
			} catch (err) {
				if (!(err instanceof errors.SessionLost)) {
					console.log("Unexpected error disconnecting connector");
					console.log(err);
				}
			}
		}

		for (let socket of pendingSockets) {
			socket.close(1001, "Server Quit");
		}

		let stopTasks = [];
		console.log("Stopping HTTP(S) server");
		if (httpServer) { stopTasks.push(new Promise(resolve => httpServer.close(resolve))); }
		if (httpsServer) { stopTasks.push(new Promise(resolve => httpsServer.close(resolve))); }
		await Promise.all(stopTasks);

		console.log(`Clusterio cleanly exited in ${Date.now() - exitStartTime}ms`);

	} catch(err) {
		setBlocking(true);
		console.error(`
+--------------------------------------------------------------------+
| Unexpected error occured while shutting down master, please report |
| it to https://github.com/clusterio/factorioClusterio/issues        |
+--------------------------------------------------------------------+`
		);
		console.error(err);
		process.exit(1);
	}
}

// wrap a request in an promise
async function downloadPage(url) {
	return new Promise((resolve, reject) => {
		request(url, (error, response, body) => {
			resolve(body);
		});
	});
}

app.get("/api/modmeta", async function(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	res.header("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "application/json");
	let modData = await downloadPage("https://mods.factorio.com/api/mods/" + req.query.modname);
	res.send(modData);
});


/**
 * Base class for master server connections
 *
 * @extends module:lib/link.Link
 */
class BaseConnection extends link.Link {
	constructor(target, connector) {
		super("master", target, connector);
		link.attachAllMessages(this);
		for (let masterPlugin of masterPlugins.values()) {
			plugin.attachPluginMessages(this, masterPlugin.info, masterPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId === null) {
			throw new errors.RequestError("Instance is not assigned to a slave");
		}

		let connection = slaveConnections.get(slaveId);
		if (!connection) {
			throw new errors.RequestError("Slave containing instance is not connected");
		}
		if (request.plugin && !connection.plugins.has(request.plugin)) {
			throw new errors.RequestError(`Slave containing instance does not have ${request.plugin} plugin`);
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

	async broadcastEventToInstance(message, event) {
		for (let slaveConnection of slaveConnections.values()) {
			// Do not broadcast back to the source
			if (slaveConnection === this) { continue; }
			if (slaveConnection.connector.closing) { continue; }
			if (event.plugin && !slaveConnection.plugins.has(event.plugin)) { continue; }

			event.send(slaveConnection, message.data);
		}
	}

	async prepareDisconnectRequestHandler(message, request) {
		await plugin.invokeHook(masterPlugins, "onPrepareSlaveDisconnect", this);
		this.connector.setClosing();
		return await super.prepareDisconnectRequestHandler(message, request);
	}

	async disconnect(code, reason) {
		try {
			await link.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof errors.SessionLost)) {
				console.error("Unexpected error preparing disconnect");
				console.error(err);
			}
		}

		await this.connector.close(code, reason);
	}
}

let controlConnections = [];
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

		this.instanceOutputSubscriptions = new Set();

		this.ws_dumper = null;
		this.connector.on("connect", () => {
			this.connector._socket.clusterio_ignore_dump = Boolean(this.ws_dumper);
		});
		this.connector.on("close", () => {
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
		return { token: generateSlaveToken(message.data.slave_id) };
	}

	async createSlaveConfigRequestHandler(message) {
		let slaveConfig = new config.SlaveConfig();
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
		let instanceConfig = new config.InstanceConfig();
		await instanceConfig.load(message.data.serialized_config);

		let instanceId = instanceConfig.get("instance.id");
		if (db.instances.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} already exists`);
		}
		db.instances.set(instanceId, { config: instanceConfig });
	}

	async deleteInstanceRequestHandler(message, request) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		if (instance.config.get("instance.assigned_slave") !== null) {
			await this.forwardRequestToInstance(message, request);
		}
		db.instances.delete(message.data.instance_id);
	}

	async getInstanceConfigRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
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
				await link.messages.assignInstance.send(connection, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize(),
				});
			}
		}
	}

	async setInstanceConfigFieldRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		if (message.data.field === "instance.assigned_slave") {
			throw new errors.RequestError("instance.assigned_slave must be set through the assign-slave interface");
		}

		if (message.data.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new errors.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(message.data.field, message.data.value);
		await this.updateInstanceConfig(instance);
	}

	async setInstanceConfigPropRequestHandler(message) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let { field, prop, value } = message.data;
		instance.config.setProp(field, prop, value);
		await this.updateInstanceConfig(instance);
	}

	async assignInstanceCommandRequestHandler(message, request) {
		let instance = db.instances.get(message.data.instance_id);
		if (!instance) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		// XXX: Should the instance be stopped if it's running on another slave?

		let connection = slaveConnections.get(message.data.slave_id);
		if (!connection) {
			// The case of the slave not getting the assign instance message
			// still have to be handled, so it's not a requirement that the
			// target slave be connected to the master while doing the
			// assignment, but it is IMHO a better user experience if this
			// is the case.
			throw new errors.RequestError("Target slave is not connected to the master server");
		}

		instance.config.set("instance.assigned_slave", message.data.slave_id);

		return await link.messages.assignInstance.send(connection, {
			instance_id: instance.config.get("instance.id"),
			serialized_config: instance.config.serialize(),
		});
	}

	async setInstanceOutputSubscriptionsRequestHandler(message) {
		this.instanceOutputSubscriptions = new Set(message.data.instance_ids);
	}

	async listPermissionsRequestHandler(message) {
		let list = [];
		for (let permission of users.permissions.values()) {
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
		db.roles.set(id, new users.Role({ id, ...message.data }));
		return { id };
	}

	async updateRoleRequestHandler(message) {
		let { id, name, description, permissions } = message.data;
		let role = db.roles.get(id);
		if (!role) {
			throw new errors.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
	}

	async grantDefaultRolePermissionsRequestHandler(message) {
		let role = db.roles.get(message.data.id);
		if (!role) {
			throw new errors.RequestError(`Role with ID ${message.data.id} does not exist`);
		}

		role.grantDefaultPermissions();
	}

	async deleteRoleRequestHandler(message) {
		let id = message.data.id;
		let role = db.roles.get(id);
		if (!role) {
			throw new errors.RequestError(`Role with ID ${id} does not exist`);
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
			throw new errors.RequestError(`User '${message.data.name}' does not exist`);
		}

		let resolvedRoles = new Set();
		for (let roleId of message.data.roles) {
			let role = db.roles.get(roleId);
			if (!role) {
				throw new errors.RequestError(`Role with ID ${roleId} does not exist`);
			}

			resolvedRoles.add(role);
		}

		user.roles = resolvedRoles;
	}

	async deleteUserRequestHandler(message) {
		if (!db.users.delete(message.data.name)) {
			throw new errors.RequestError(`User '${message.data.name}' does not exist`);
		}
	}

	async debugDumpWsRequestHandler(message) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				link.messages.debugWsMessage.send(this, data);
			}
		};
		this.connector._socket.clusterio_ignore_dump = true;
		debugEvents.on("message", this.ws_dumper);
	}
}

var slaveConnections = new Map();
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

	async instanceInitializedEventHandler(message, event) {
		let instance = db.instances.get(message.data.instance_id);
		let prev = instance.status;
		instance.status = "initialized";
		console.log(`Clusterio | Instance ${instance.config.get("instance.name")} Initialized`);
		await plugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
	}

	async instanceStartedEventHandler(message, event) {
		let instance = db.instances.get(message.data.instance_id);
		let prev = instance.status;
		instance.status = "running";
		console.log(`Clusterio | Instance ${instance.config.get("instance.name")} Started`);
		await plugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
	}

	async instanceStoppedEventHandler(message, event) {
		let instance = db.instances.get(message.data.instance_id);
		let prev = instance.status;
		instance.status = "stopped";
		console.log(`Clusterio | Instance ${instance.config.get("instance.name")} Stopped`);
		await plugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
	}

	async updateInstancesEventHandler(message) {
		// Push updated instance configs
		for (let instance of db.instances.values()) {
			if (instance.config.get("instance.assigned_slave") === this._id) {
				await link.messages.assignInstance.send(this, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize(),
				});
			}
		}

		// Assign instances the slave has but master does not
		for (let instance of message.data.instances) {
			let instanceConfig = new config.InstanceConfig();
			await instanceConfig.load(instance.serialized_config);

			let masterInstance = db.instances.get(instanceConfig.get("instance.id"));
			if (masterInstance) {
				// Already have this instance, update state instead
				if (masterInstance.status !== instance.status) {
					let prev = masterInstance.status;
					masterInstance.status = instance.status;
					if (prev !== undefined) {
						await plugin.invokeHook(masterPlugins, "onInstanceStatusChanged", instance, prev);
					}
				}
				continue;
			}

			instanceConfig.set("instance.assigned_slave", this._id);
			db.instances.set(instanceConfig.get("instance.id"), { config: instanceConfig });
			await link.messages.assignInstance.send(this, {
				instance_id: instanceConfig.get("instance.id"),
				serialized_config: instanceConfig.serialize(),
			});
		}
	}

	async instanceOutputEventHandler(message) {
		let { instance_id, output } = message.data;
		for (let controlConnection of controlConnections) {
			if (controlConnection.instanceOutputSubscriptions.has(instance_id)) {
				link.messages.instanceOutput.send(controlConnection, message.data);
			}
		}
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
		await plugin.invokeHook(masterPlugins, "onPlayerEvent", instance, message.data);
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
class WebSocketServerConnector extends link.WebSocketBaseConnector {
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
		console.log("SOCKET | Connection timed out");
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
			console.log(`SOCKET | Close (code: ${code}, reason: ${reason})`);
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
			console.error("SOCKET | Error:", err);
		});

		this._socket.on("open", () => {
			console.log("SOCKET | Open");
		});
		this._socket.on("ping", data => {
			console.log(`SOCKET | Ping (data: ${data}`);
		});
		this._socket.on("pong", data => {
			console.log(`SOCKET | Pong (data: ${data}`);
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

let pendingSockets = new Set();
let activeConnectors = new Map();

wss.on("connection", function (socket, req) {
	console.log(`SOCKET | new connection from ${req.socket.remoteAddress}`);

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
		plugins: pluginList,
	}}));

	function attachHandler() {
		pendingSockets.add(socket);

		let timeoutId = setTimeout(() => {
			console.log(`SOCKET | closing ${req.socket.remoteAddress} after timing out on handshake`);
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
				console.error(`
+----------------------------------------------------------------+
| Unexpected error occured in WebSocket handshake, please report |
| it to https://github.com/clusterio/factorioClusterio/issues    |
+----------------------------------------------------------------+`
				);
				console.error(err);
				wsRejectedConnectionsCounter.inc();
				socket.close(1011, "Unexpected error");
			});
		});
	}

	attachHandler();
});

let nextSessionId = 1;

// Unique string for the session token audience
let masterSession = `session-${Date.now()}`;

// Handle socket handshake
async function handleHandshake(message, socket, req, attachHandler) {
	try {
		message = JSON.parse(message);
	} catch (err) {
		console.log(`SOCKET | closing ${req.socket.remoteAddress} after receiving invalid JSON`);
		wsRejectedConnectionsCounter.inc();
		socket.close(1002, "Invalid JSON");
		return;
	}

	if (!schema.clientHandshake(message)) {
		console.log(`SOCKET | closing ${req.socket.remoteAddress} after receiving invalid handshake:`, message);
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

		} catch(err) {
			socket.send(JSON.stringify({ seq: null, type: "invalidate", data: {}}));
			attachHandler();
			return;
		}

		connector.continue(socket, data.last_seq);
		return;
	}

	if (stopAcceptingNewSessions) {
		console.log(`SOCKET | closing ${req.socket.remoteAddress}, server is shutting down`);
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
		console.error(`SOCKET | authentication failed for ${req.socket.remoteAddress}`);
		wsRejectedConnectionsCounter.inc();
		socket.close(4003, `Authentication failed: ${err.message}`);
		return;
	}

	let sessionId = nextSessionId++;
	let sessionToken = jwt.sign({ aud: masterSession, sid: sessionId }, masterConfig.get("master.auth_secret"));
	let connector = new WebSocketServerConnector(socket, sessionId);
	activeConnectors.set(sessionId, connector);

	if (type === "register_slave") {
		let connection = slaveConnections.get(data.id);
		if (connection) {
			console.log(`SOCKET | disconnecting existing connection for slave ${data.id}`);
			connection.connector.setTimeout(15); // Slave connection is likely stalled
			await connection.disconnect(1008, "Registered from another connection");
		}

		console.log(`SOCKET | registered slave ${data.id} version ${data.version}`);
		slaveConnections.set(data.id, new SlaveConnection(data, connector));

	} else if (type === "register_control") {
		console.log(`SOCKET | registered control from ${req.socket.remoteAddress}`);
		controlConnections.push(new ControlConnection(data, connector, user));
	}

	connector.ready(sessionToken);
}

// handle plugins on the master
var masterPlugins = new Map();
async function pluginManagement(pluginInfos) {
	let startPluginLoad = Date.now();
	masterPlugins = await loadPlugins(pluginInfos);
	console.log("All plugins loaded in "+(Date.now() - startPluginLoad)+"ms");
}

async function loadPlugins(pluginInfos) {
	let plugins = new Map();
	for (let pluginInfo of pluginInfos) {
		if (!masterConfig.group(pluginInfo.name).get("enabled")) {
			continue;
		}

		pluginList[pluginInfo.name] = pluginInfo.version;

		let pluginLoadStarted = Date.now();
		let MasterPlugin = plugin.BaseMasterPlugin;
		try {
			if (pluginInfo.masterEntrypoint) {
				({ MasterPlugin } = require(`./plugins/${pluginInfo.name}/${pluginInfo.masterEntrypoint}`));
			}

			let masterPlugin = new MasterPlugin(
				pluginInfo, { app, config: masterConfig, db, slaveConnections }, { endpointHitCounter }
			);
			await masterPlugin.init();
			plugins.set(pluginInfo.name, masterPlugin);

		} catch (err) {
			throw new errors.PluginError(pluginInfo.name, err);
		}

		console.log(`Clusterio | Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
	}
	return plugins;
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
			console.log("handling upgrade");

			// For reasons that defy common sense, the connection event has
			// to be emitted explictly when using noServer.
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
		});

		function wrapError(err) {
			reject(new errors.StartupError(
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

async function startServer() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioMaster";

	// add better stack traces on promise rejection
	process.on("unhandledRejection", r => console.log(r));

	// argument parsing
	let args = yargs
		.scriptName("master")
		.usage("$0 <command> [options]")
		.option("config", {
			nargs: 1,
			describe: "master config file to use",
			default: "config-master.json",
			type: "string",
		})
		.command("config", "Manage Master config", config.configCommand)
		.command("bootstrap", "Bootstrap access to cluster", yargs => {
			yargs
				.command("create-admin <name>", "Create a cluster admin")
				.command("create-ctl-config <name>", "Create clusterctl config for the given user", yargs => {
					yargs.option("output", {
						describe: "Path to output config (- for stdout)", type: "string",
						nargs: 1, default: "config-control.json",
					});
				})
				.demandCommand(1, "You need to specify a command to run");
		})
		.command("run", "Run master server")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	console.log("Loading Plugin info");
	let pluginInfos = await plugin.loadPluginInfos("plugins");
	config.registerPluginConfigGroups(pluginInfos);
	config.finalizeConfigs();

	masterConfigPath = args.config;
	console.log(`Loading config from ${masterConfigPath}`);
	masterConfig = new config.MasterConfig();
	try {
		await masterConfig.load(JSON.parse(await fs.readFile(masterConfigPath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("Config not found, initializing new config");
			await masterConfig.init();

		} else {
			throw err;
		}
	}

	let command = args._[0];
	if (command === "config") {
		await config.handleConfigCommand(args, masterConfig, masterConfigPath);
		return;

	} else if (command === "bootstrap") {
		let subCommand = args._[1];
		await loadUsers(masterConfig.get("master.database_directory"), "users.json");
		if (subCommand === "create-admin") {
			if (!args.name) {
				console.error("name cannot be blank");
				process.exitCode = 1;
				return;
			}

			let admin = db.users.get(args.name);
			if (!admin) {
				admin = createUser(args.name);
			}

			let adminRole = users.ensureDefaultAdminRole(db.roles);
			admin.roles.add(adminRole);
			await saveUsers(masterConfig.get("master.database_directory"), "users.json");

		} else if (subCommand === "create-ctl-config") {
			let admin = db.users.get(args.name);
			if (!admin) {
				console.error(`No user named '${args.name}'`);
				process.exitCode = 1;
				return;
			}
			let controlConfig = new config.ControlConfig();
			await controlConfig.init();

			controlConfig.set("control.master_url", getMasterUrl());
			controlConfig.set("control.master_token", admin.createToken(masterConfig.get("master.auth_secret")));

			let content = JSON.stringify(controlConfig.serialize(), null, 4);
			if (args.output === "-") {
				console.log(content);
			} else {
				console.log(`Writing ${args.output}`);
				await fs.outputFile(args.output, content);
			}
		}

		// Save config in case the auth_secret was generated during this invocation.
		await fs.outputFile(masterConfigPath, JSON.stringify(masterConfig.serialize(), null, 4));
		return;
	}

	// If we get here the command was run

	let secondSigint = false;
	process.on("SIGINT", () => {
		if (secondSigint) {
			console.log("Caught second interrupt, terminating immediately");
			process.exit(1);
		}

		secondSigint = true;
		console.log("Caught interrupt signal, shutting down");
		shutdown();
	});

	// terminal closed
	process.on("SIGHUP", () => {
		// No graceful cleanup, no warning out (stdout is likely closed.)
		// Don't close the terminal with the clusterio master in it.
		process.exit(1);
	});

	await fs.ensureDir(masterConfig.get("master.database_directory"));

	db.slaves = await loadMap(masterConfig.get("master.database_directory"), "slaves.json");
	db.instances = await loadInstances(masterConfig.get("master.database_directory"), "instances.json");
	await loadUsers(masterConfig.get("master.database_directory"), "users.json");

	// Make sure we're actually going to listen on a port
	let httpPort = masterConfig.get("master.http_port");
	let httpsPort = masterConfig.get("master.https_port");
	if (!httpPort && !httpsPort) {
		console.error("Error: at least one of http_port and https_port must be configured");
		process.exit(1);
	}

	let tls_cert = masterConfig.get("master.tls_certificate");
	let tls_key = masterConfig.get("master.tls_private_key");
	// Create a self signed certificate if the certificate files doesn't exist
	if (httpsPort && !await fs.exists(tls_cert) && !await fs.exists(tls_key)) {
		await generateSSLcert({
			bits: masterConfig.get("master.tls_bits"),
			sslCertPath: tls_cert,
			sslPrivKeyPath: tls_key,
			doLogging: true,
		});
	}

	// Load plugins
	await pluginManagement(pluginInfos);

	// Only start listening for connections after all plugins have loaded
	if (httpPort) {
		httpServer = require("http").Server(app);
		await listen(httpServer, httpPort);
		console.log("Listening for HTTP on port %s...", httpServer.address().port);
	}

	if (httpsPort) {
		let certificate, privateKey;
		try {
			certificate = await fs.readFile(tls_cert);
			privateKey = await fs.readFile(tls_key);

		} catch (err) {
			throw new errors.StartupError(
				`Error loading ssl certificate: ${err.message}`
			);
		}

		httpsServer = require("https").createServer({
			key: privateKey,
			cert: certificate,
		}, app);
		await listen(httpsServer, httpsPort);
		console.log("Listening for HTTPS on port %s...", httpsServer.address().port);
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
	console.warn(`
+==========================================================+
I WARNING:  This is the development branch for the 2.0     I
I           version of clusterio.  Expect things to break. I
+==========================================================+
`
	);
	startServer().catch(err => {
		if (err instanceof errors.StartupError) {
			console.error(`
+----------------------------------+
| Unable to to start master server |
+----------------------------------+`
			);
		} else if (err instanceof errors.PluginError) {
			console.error(`
Error: ${err.pluginName} plugin threw an unexpected error
       during startup, please report it to the plugin author.
--------------------------------------------------------------`
			);
			err = err.original;
		} else {
			console.error(`
+---------------------------------------------------------------+
| Unexpected error occured while starting master, please report |
| it to https://github.com/clusterio/factorioClusterio/issues   |
+---------------------------------------------------------------+`
			);
		}

		console.error(err);
		return shutdown();
	});
}
