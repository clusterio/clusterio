/**
Clusterio master server. Facilitates communication between slaves through
a webserver, storing data related to slaves like production graphs.

@module clusterioMaster
@author Danielv123

@example
node master
*/

// Attempt updating
// const updater = require("./updater");
// updater.update().then(console.log);

const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs-extra");
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const moment = require("moment");
const request = require("request");
const setBlocking = require("set-blocking");
const events = require("events");
const yargs = require("yargs");
const version = require("./package").version;

// ugly globals
let masterConfig;
let masterConfigPath;

// homebrew modules
const generateSSLcert = require("lib/generateSSLcert");
const database = require("lib/database");
const factorio = require("lib/factorio");
const schema = require("lib/schema");
const link = require("lib/link");
const errors = require("lib/errors");
const plugin = require("lib/plugin");
const prometheus = require("lib/prometheus");
const config = require("lib/config");

// homemade express middleware for token auth
const authenticate = require("lib/authenticate");

const express = require("express");
const compression = require('compression');
const cookieParser = require('cookie-parser');
// Required for express post requests
const bodyParser = require("body-parser");
const fileUpload = require('express-fileupload');
var app = express();
var httpServer;
var httpsServer;

app.use(cookieParser());
app.use(bodyParser.json({
	limit: '10mb',
}));
app.use(bodyParser.urlencoded({
	parameterLimit: 100000,
	limit: '10mb',
	extended: true
}));
app.use(fileUpload());
app.use(compression());

// dynamic HTML generations with EJS
app.set('view engine', 'ejs');
app.set('views', ['views', 'sharedPlugins']);

// give ejs access to some interesting information
app.use(function(req, res, next){
	res.locals.res = res;
	res.locals.req = req;
	res.locals.slaves = db.slaves;
	res.locals.moment = moment;
	next();
});

require("./routes")(app);
require("./routes/api/getPictures")(app);
// Set folder to serve static content from (the website)
app.use(express.static('static'));

const endpointHitCounter = new prometheus.Gauge(
	'clusterio_master_http_endpoint_hits_total', "How many requests a particular endpoint has gotten",
	{ labels: ['route'] }
);

// Prometheus polling endpoint
async function getMetrics(req, res, next) {
	endpointHitCounter.labels(req.route.path).inc();

	let results = []
	for (let masterPlugin of masterPlugins.values()) {
		let pluginResults = await masterPlugin.onMetrics();
		if (pluginResults !== undefined) {
			for await (let result of pluginResults) {
				results.push(result)
			}
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

	let text = await prometheus.exposition(results);
	res.set('Content-Type', prometheus.exposition.contentType);
	res.send(text);
}
app.get('/metrics', (req, res, next) => getMetrics(req, res, next).catch(next));


const masterConnectedClientsCount = new prometheus.Gauge(
	'clusterio_master_connected_clients_count', "How many clients are currently connected to this master server",
	{
		labels: ['type'], callback: async function(gauge) {
			gauge.labels("slave").set(slaveConnections.size);
			gauge.labels("control").set(controlConnections.length);
		},
	},
);

// set up database
const db = {};

/**
 * Load Map from JSON file in the database directory.
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
			instances.set(instanceConfig.get("instance.id"), instanceConfig);
		}

	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}

	return instances;
}

/**
 * Save Map to JSON file in the database directory.
 */
async function saveMap(databaseDirectory, file, map) {
	let databasePath = path.resolve(databaseDirectory, file);
	console.log(`Saving ${databasePath}`);
	await database.saveMapAsJsonArray(databasePath, map);
}

async function saveInstances(databaseDirectory, file, instances) {
	let filePath = path.join(databaseDirectory, file);
	let serialized = [];
	for (let instanceConfig of instances.values()) {
		serialized.push(instanceConfig.serialize());
	}

	await fs.outputFile(filePath, JSON.stringify(serialized, null, 4));
}

/**
 * Innitiate shutdown of master server
 */
async function shutdown() {
	console.log('Shutting down');
	let exitStartTime = Date.now();
	try {
		console.log("Saving configs");
		await fs.outputFile(masterConfigPath, JSON.stringify(masterConfig.serialize(), null, 4));

		await saveMap(masterConfig.get('master.database_directory'), "slaves.json", db.slaves);
		await saveInstances(masterConfig.get('master.database_directory'), "instances.json", db.instances);

		for (let [pluginName, masterPlugin] of masterPlugins) {
			let startTime = Date.now();
			await masterPlugin.onExit();
			console.log(`Plugin ${pluginName} exited in ${Date.now() - startTime}ms`);
		}

		for (let controlConnection of controlConnections) {
			controlConnection.connector.close("shutdown");
		}

		for (let slaveConnection of slaveConnections.values()) {
			slaveConnection.connector.close("shutdown");
		}

		if (httpServer) {
			console.log("Stopping HTTP server");
			await new Promise(resolve => httpServer.close(resolve));
		}

		if (httpsServer) {
			console.log("Stopping HTTPS server");
			await new Promise(resolve => httpsServer.close(resolve));
		}

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
	res.setHeader('Content-Type', 'application/json');
	let modData = await downloadPage("https://mods.factorio.com/api/mods/" + req.query.modname);
	res.send(modData);
});


var localeCache;
/**
GET endpoint. Returns factorio's base locale as a JSON object.

@memberof clusterioMaster
@instance
@alias api/getFactorioLocale
@returns {object<string, object>} 2 deep nested object with base game factorio locale as key:value pairs
*/
app.get("/api/getFactorioLocale", function(req,res){
	endpointHitCounter.labels(req.route.path).inc();
	if (!localeCache) {
		factorio.getLocale(path.join(masterConfig.get("master.factorio_directory"), "data"), "en").then(locale => {
			localeCache = locale;
			res.send(localeCache);
		});
	} else {
		res.send(localeCache);
	}
});

// socket.io connection for slaves
var io = require("socket.io")({});

class BaseConnection extends link.Link {
	constructor(target, connector) {
		super('master', target, connector);
		link.attachAllMessages(this);
		for (let masterPlugin of masterPlugins.values()) {
			plugin.attachPluginMessages(this, masterPlugin.info, masterPlugin);
		}
	}

	async forwardRequestToInstance(message, request) {
		let instanceConfig = db.instances.get(message.data.instance_id);
		if (!instanceConfig) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		let slaveId = instanceConfig.get('instance.assigned_slave');
		if (slaveId === null) {
			throw new errors.RequestError("Instance is not assigned to a slave");
		}

		let connection = slaveConnections.get(slaveId);
		if (!connection) {
			throw new errors.RequestError("Slave containing instance is not connected");
		}

		return await request.send(connection, message.data);
	}

	async forwardEventToInstance(message, event) {
		let instanceConfig = db.instances.get(message.data.instance_id);
		if (!instanceConfig) { return; }

		let slaveId = instanceConfig.get('instance.assigned_slave');
		if (slaveId === null) { return; }

		let connection = slaveConnection.get(slaveId);
		if (!connection) { return; }

		event.send(connection, message.data);
	}

	async broadcastEventToInstance(message, event) {
		for (let slaveConnection of slaveConnections.values()) {
			if (slaveConnection === this) {
				continue; // Do not broadcast back to the source
			}

			event.send(slaveConnection, message.data);
		}
	}
}

let controlConnections = new Array();
class ControlConnection extends BaseConnection {
	constructor(registerData, connector) {
		super('control', connector)

		this._agent = registerData.agent;
		this._version = registerData.version;

		this.connector.on('disconnect', () => {
			let index = controlConnections.indexOf(this);
			if (index !== -1) {
				controlConnections.splice(index, 1);
			}
		});

		this.instanceOutputSubscriptions = new Set();
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

	async listInstancesRequestHandler(message) {
		let list = [];
		for (let instanceConfig of db.instances.values()) {
			list.push({
				id: instanceConfig.get("instance.id"),
				name: instanceConfig.get("instance.name"),
				assigned_slave: instanceConfig.get("instance.assigned_slave"),
			});
		}
		return { list };
	}

	// XXX should probably add a hook for slave reuqests?
	async createInstanceRequestHandler(message) {
		let instanceConfig = new config.InstanceConfig();
		await instanceConfig.load(message.data.serialized_config);

		let instanceId = instanceConfig.get("instance.id")
		if (db.instances.has(instanceId)) {
			throw new errors.RequestError(`Instance with ID ${instanceId} already exists`);
		}
		db.instances.set(instanceId, instanceConfig);
	}

	async getInstanceConfigRequestHandler(message) {
		let instanceConfig = db.instances.get(message.data.instance_id);
		if (!instanceConfig) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		return {
			serialized_config: instanceConfig.serialize(),
		}
	}

	async setInstanceConfigFieldRequestHandler(message) {
		let instanceConfig = db.instances.get(message.data.instance_id);
		if (!instanceConfig) {
			throw new errors.RequestError(`Instance with ID ${message.data.instance_id} does not exist`);
		}

		if (message.data.field === "instance.assigned_slave") {
			throw new errors.RequestError("instance.assigned_slave must be set through the assign-slave interface");
		}

		if (message.data.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new errors.RequestError("Setting instance.id is not supported");
		}

		instanceConfig.set(message.data.field, message.data.value);

		// Push updated config to slave
		let slaveId = instanceConfig.get('instance.assigned_slave');
		if (slaveId) {
			let connection = slaveConnections.get(slaveId);
			if (connection) {
				await link.messages.assignInstance.send(connection, {
					instance_id: instanceConfig.get("instance.id"),
					serialized_config: instanceConfig.serialize(),
				});
			}
		}
	}

	async assignInstanceCommandRequestHandler(message, request) {
		let instanceConfig = db.instances.get(message.data.instance_id);
		if (!instanceConfig) {
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

		instanceConfig.set("instance.assigned_slave", message.data.slave_id)

		return await link.messages.assignInstance.send(connection, {
			instance_id: instanceConfig.get("instance.id"),
			serialized_config: instanceConfig.serialize(),
		});
	}

	async setInstanceOutputSubscriptionsRequestHandler(message) {
		this.instanceOutputSubscriptions = new Set(message.data.instance_ids);
	}
}

var slaveConnections = new Map();
class SlaveConnection extends BaseConnection {
	constructor(registerData, connector) {
		super('slave', connector);

		this._agent = registerData.agent;
		this._id = registerData.id;
		this._name = registerData.name;
		this._version = registerData.version;

		db.slaves.set(this._id, {
			agent: this._agent,
			id: this._id,
			name: this._name,
			version: this._version,
		});

		this.connector.on('message', () => {
			// XXX prometheusWsUsageCounter.labels('message', "other").inc();
		});

		this.connector.on('disconnect', () => {
			if (slaveConnections.get(this._id) === this) {
				slaveConnections.delete(this._id);
			}
		});
	}

	async updateInstancesEventHandler(message) {
		// Push updated instance configs
		for (let instanceConfig of db.instances.values()) {
			if (instanceConfig.get("instance.assigned_slave") === this._id) {
				await link.messages.assignInstance.send(this, {
					instance_id: instanceConfig.get("instance.id"),
					serialized_config: instanceConfig.serialize(),
				});
			}
		}

		// Assign instances the slave has but master does not
		for (let instance of message.data.instances) {
			let instanceConfig = new config.InstanceConfig();
			await instanceConfig.load(instance.serialized_config);
			if (db.instances.has(instanceConfig.get("instance.id"))) {
				continue;
			}

			instanceConfig.set("instance.assigned_slave", this._id);
			db.instances.set(instanceConfig.get("instance.id"), instanceConfig);
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
}

// Authentication middleware for socket.io connections
io.use((socket, next) => {
	let token = socket.handshake.query.token;
	authenticate.check(token).then((result) => {
		if (result.ok) {
			next();
		} else {
			console.error(`SOCKET | authentication failed for ${socket.handshake.address}`);
			next(new Error(result.msg));
		}
	});
});

/**
 * Returns true if value is a signed 32-bit integer
 *
 * @param value - value to test.
 * @returns {Boolean}
 *     true if value is an integer between -2**31 and 2**31-1.
 */
function isInteger(value) {
	return value | 0 === value;
}


/**
 * Connector for master server connections
 */
class SocketIOServerConnector extends events.EventEmitter {
	constructor(socket) {
		super();

		this._seq = 1;
		this._socket = socket;

		this._socket.on('message', message => {
			this.emit('message', message);
		});
		this._socket.on('disconnect', () => {
			this.emit('disconnect');
		});
	}

	/**
	 * Send a message over the socket
	 *
	 * @returns the sequence number of the message sent
	 */
	send(type, data = {}) {
		this._socket.send({ seq: this._seq, type, data });
		return this._seq++;
	}

	/**
	 * Close the connection with the given reason.
	 *
	 * Sends a close message and disconnects the connector.
	 */
	close(reason) {
		this.send('close', { reason });
		this.disconnect();
	}

	/**
	 * Immediatly close the connection
	 */
	disconnect() {
		this._socket.disconnect(true);
	}
}

io.on('connection', function (socket) {
	console.log(`SOCKET | new connection from ${socket.handshake.address}`);

	// Start connection handshake
	let connector = new SocketIOServerConnector(socket);
	connector.send('hello', { version });

	// Handle socket handshake
	socket.once('message', (payload) => {
		// XXX prometheusWsUsageCounter.labels('message', "other").inc();
		if (!schema.clientHandshake(payload)) {
			console.log(`SOCKET | closing ${socket.handshake.address} after receiving invalid handshake`, payload);
			connector.send('close', { reason: "Invalid handshake" });
			connector.disconnect(true);
			return;
		}

		let { seq, type, data } = payload;
		if (type === "register_slave") {
			let connection = slaveConnections.get(data.id);
			if (connection) {
				console.log(`SOCKET | disconecting existing connection for slave ${data.id}`);
				connection.connector.close("Registered from another connection");
			}

			console.log(`SOCKET | registered slave ${data.id} version ${data.version}`);
			slaveConnections.set(data.id, new SlaveConnection(data, connector));
			connector.send('ready');

		} else if (type === "register_control") {
			console.log(`SOCKET | registered control from ${socket.handshake.address}`);
			controlConnections.push(new ControlConnection(data, connector));
			connector.send('ready');

		} else if (type === "close") {
			console.log(`SOCKET | received close from ${socket.handshake.address}: ${data.reason}`);
			connector.disconnect();
			return;
		}
	});
});

// handle plugins on the master
var masterPlugins = new Map();
async function pluginManagement(pluginInfos) {
	let startPluginLoad = Date.now();
	masterPlugins = await loadPlugins(pluginInfos);
	console.log("All plugins loaded in "+(Date.now() - startPluginLoad)+"ms");
}

async function loadPlugins(pluginInfos) {
	let plugins = new Map();
	for (pluginInfo of pluginInfos) {
		if (!masterConfig.group(pluginInfo.name).get("enabled")) {
			continue;
		}

		let pluginLoadStarted = Date.now();
		let MasterPlugin = plugin.BaseMasterPlugin;
		if (pluginInfo.masterEntrypoint) {
			({ MasterPlugin } = require(`./plugins/${pluginInfo.name}/${pluginInfo.masterEntrypoint}`));
		}

		let masterPlugin = new MasterPlugin(pluginInfo);
		await masterPlugin.init();
		plugins.set(pluginInfo.name, masterPlugin);

		console.log(`Clusterio | Loaded plugin ${pluginInfo.name} in ${Date.now() - pluginLoadStarted}ms`);
		/*
			main:new masterPlugin({
			TODO?
				config, socketio: io, express: app,
				db,
			}),
			pluginConfig,
		});*/
	}
	return plugins;
}

/**
 * Calls listen on server capturing any errors that occurs
 * binding to the port.
 */
function listen(server, ...args) {
	return new Promise((resolve, reject) => {
		function wrapError(err) {
			reject(new errors.StartupError(
				`Server listening failed: ${err.message}`
			));
		}

		server.once('error', wrapError);
		server.listen(...args, () => {
			server.off('error', wrapError);
			resolve();
		});
	});
}

function _setConfig(config) {
	masterConfig = config;
}

async function startServer() {
	// Set the process title, shows up as the title of the CMD window on windows
	// and as the process name in ps/top on linux.
	process.title = "clusterioMaster";

	// add better stack traces on promise rejection
	process.on('unhandledRejection', r => console.log(r));

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
		.command("run", "Run master server")
		.demandCommand(1, "You need to specify a command to run")
		.strict()
		.argv
	;

	console.log("Loading Plugin info");
	let pluginInfos = await plugin.loadPluginInfos("plugins")
	config.registerPluginConfigGroups(pluginInfos);
	config.finalizeConfigs();

	masterConfigPath = args.config;
	console.log(`Loading config from ${masterConfigPath}`);
	masterConfig = new config.MasterConfig();
	try {
		await masterConfig.load(JSON.parse(await fs.readFile(masterConfigPath)));

	} catch (err) {
		if (err.code === 'ENOENT') {
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
	}

	// If we get here the command was run

	// write an auth token to file
	fs.writeFileSync("secret-api-token.txt", jwt.sign({ id: "api" }, masterConfig.get('master.auth_secret'), {
		expiresIn: 86400*365 // expires in 1 year
	}));

	let secondSigint = false
	process.on('SIGINT', () => {
		if (secondSigint) {
			console.log("Caught second interrupt, terminating immediately");
			process.exit(1);
		}

		secondSigint = true;
		console.log("Caught interrupt signal, shutting down");
		shutdown();
	});

	// terminal closed
	process.on('SIGHUP', () => {
		// No graceful cleanup, no warning out (stdout is likely closed.)
		// Don't close the terminal with the clusterio master in it.
		process.exit(1);
	});

	await fs.ensureDir(masterConfig.get('master.database_directory'));

	db.slaves = await loadMap(masterConfig.get('master.database_directory'), "slaves.json");
	db.instances = await loadInstances(masterConfig.get('master.database_directory'), "instances.json");

	authenticate.setAuthSecret(masterConfig.get('master.auth_secret'));

	// Make sure we're actually going to listen on a port
	let httpPort = masterConfig.get('master.http_port');
	let httpsPort = masterConfig.get('master.https_port');
	if (!httpPort && !httpsPort) {
		console.error("Error: at least one of http_port and https_port must be configured");
		process.exit(1);
	}

	let tls_cert = masterConfig.get('master.tls_certificate');
	let tls_key = masterConfig.get('master.tls_private_key');
	// Create a self signed certificate if the certificate files doesn't exist
	if (httpsPort && !await fs.exists(tls_cert) && !await fs.exists(tls_key)) {
		await generateSSLcert({
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
		io.attach(httpServer);
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
			cert: certificate
		}, app)
		await listen(httpsServer, httpsPort);

		// XXX I'm uncertain whether or not socket.io actually supports
		// attaching to multiple servers at the same time.
		io.attach(httpsServer);
		console.log("Listening for HTTPS on port %s...", httpsServer.address().port);
	}
}

module.exports = {
	app,

	// For testing only
	_db: db,
	_setConfig,
	_SocketIOServerConnector: SocketIOServerConnector,
	_controlConnections: controlConnections,
	_ControlConnection: ControlConnection,
	_slaveConnections: slaveConnections,
	_SlaveConnection: SlaveConnection,
}

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
