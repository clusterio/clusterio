"use strict";
const fs = require("fs-extra");
const path = require("path");
const yargs = require("yargs");
const events = require("events");
const pidusage = require("pidusage");
const setBlocking = require("set-blocking");
const phin = require("phin");
const stream = require("stream");
const util = require("util");

// internal libraries
const libData = require("@clusterio/lib/data");
const libFileOps = require("@clusterio/lib/file_ops");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libErrors = require("@clusterio/lib/errors");
const libPrometheus = require("@clusterio/lib/prometheus");
const libConfig = require("@clusterio/lib/config");
const { logger } = require("@clusterio/lib/logging");
const libHelpers = require("@clusterio/lib/helpers");

const Instance = require("./Instance");
const InstanceConnection = require("./InstanceConnection");

const finished = util.promisify(stream.finished);


function checkRequestSaveName(name) {
	try {
		libFileOps.checkFilename(name);
	} catch (err) {
		throw new libErrors.RequestError(`Save name ${err.message}`);
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
 * @returns {Promise<Map<integer, Object>>}
 *     mapping between instance id and information about this instance.
 * @private
 */
async function discoverInstances(instancesDir) {
	let instanceInfos = new Map();
	for (let entry of await fs.readdir(instancesDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			let instanceConfig = new libConfig.InstanceConfig("host");
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

			if (instanceInfos.has(instanceConfig.get("instance.id"))) {
				logger.warn(`Ignoring instance with duplicate id in folder ${entry.name}`);
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

const instanceStartingMessages = new Set([
	libData.InstanceStartRequest.name,
	libData.InstanceLoadScenarioRequest.name,
	libData.InstanceCreateSaveRequest.name,
	libData.InstanceExportDataRequest.name,
]);

class HostRouter {
	/** @type {module:lib/host/src/Host} */
	host;

	constructor(host) {
		this.host = host;
	}

	/**
	 * Forward a message to the next hop towards its destination.
	 *
	 * @param {module:lib/link.Link} origin -
	 *    Link the message originated from.
	 * @param {module:lib/data.Message} message - Message to process.
	 * @param {boolean} hasFallback - is fallback available
	 * @returns {boolean} true if the message was handled, false if fallback
	 *     is requested
	 */
	forwardMessage(origin, message, hasFallback) {
		let dst = message.dst;
		let nextHop;
		let msg;
		if (dst.type === libData.Address.broadcast) {
			this.broadcastMessage(origin, message);
			return true;
		} else if (
			dst.type === libData.Address.controller
			|| dst.type === libData.Address.control
			|| dst.type === libData.Address.host && dst.id !== this.host.config.get("host.id")
			|| dst.type === libData.Address.instance && !this.host.instanceInfos.has(dst.id)
		) {
			nextHop = this.host;
		} else if (dst.type === libData.Address.instance && this.host.instanceInfos.has(dst.id)) {
			nextHop = this.host.instanceConnections.get(dst.id);
		}

		if (nextHop === origin) {
			msg = `Message would return back to sender ${origin.dst}.`;
			nextHop = undefined;
		}

		if (message.type === "request") {
			if (dst.type === libData.Address.instance && instanceStartingMessages.has(message.name)) {
				this.wakeInstance(origin, message, nextHop);
				return true;

			} else if (!nextHop) {
				if (dst.type === libData.Address.instance) {
					if (hasFallback) {
						return false;
					}
					origin.connector.sendResponseError(
						new libData.ResponseError("Instance is not running."), message.src
					);
				}
				return true;
			}

			// XXX What if the session is invalidated and there is no
			// response?  Need to track pending requests here.
		}

		if (nextHop) {
			this.sendMessage(nextHop, message);
		} else {
			this.warnUnrouted(message, msg);
		}

		return true;
	}

	broadcastMessage(origin, message) {
		let dst = message.dst;
		if (message.type !== "event") {
			this.warnUnrouted(message, `Unexpected broadcast of ${message.type}`);
		} else if (dst.id === libData.Address.host || dst.id === libData.Address.instance) {
			for (let instanceConnection of this.host.instanceConnections.values()) {
				if (instanceConnection !== origin) {
					instanceConnection.connector.send(message);
				}
			}
			if (this.host !== origin) {
				this.host.connector.send(message);
			}
		} else if (dst.id === libData.Address.control) {
			if (this.host !== origin) {
				this.host.connector.send(message);
			} else {
				logger.warn(`Received control broadcast of ${message.name} from master.`);
			}
		} else {
			this.warnUnrouted(message, `Unexpected broacdast target ${dst.id}`);
		}
	}

	wakeInstance(origin, message, nextHop) {
		let dst = message.dst;
		if (nextHop) {
			origin.connector.sendResponseError(
				new libData.ResponseError("Instance is already running."), message.src
			);
			return;
		}
		if (this.host._shuttingDown) {
			origin.connector.sendResponseError(
				new libData.ResponseError("Host is shutting down."), message.src
			);
			return;
		}

		this.host._connectInstance(dst.id).then(instanceConnection => {
			instanceConnection.connector.send(message);
		}).catch(err => {
			logger.error(`Error starting instance:\n${err.stack}`, this.host.instanceLogMeta(dst.id));
			origin.connector.sendResponseError(
				new libData.ResponseError(err.message, err.code, err.stack), message.src
			);
		});
	}

	sendMessage(nextHop, message) {
		try {
			nextHop.connector.send(message);
		} catch (err) {
			if (message.type === "request") {
				origin.connector.sendResponseError(
					new libData.ResponseError(err.message, err.code, err.stack), message.src
				);
			}
			logger.warn(`Failed to deliver ${message.name || "message"} (${message.type}): ${err.message}`);
		}
	}

	warnUnrouted(message, msg) {
		let dst = message.dst;
		let baseMsg = `No destination for ${message.constructor.name} routed from ${message.src} to ${dst}`;
		logger.warn(msg ? `${baseMsg}: ${msg}.` : `${baseMsg}.`);
	}
}

/**
 * Handles running the host
 *
 * Connects to the controller over the WebSocket and manages intsances.
 * @alias module:host/src/Host
 */
class Host extends libLink.Link {
	constructor(connector, hostConfig, tlsCa, pluginInfos) {
		super(connector);

		this.router = new HostRouter(this);
		this.pluginInfos = pluginInfos;
		this.config = hostConfig;

		/**
		 * Certificate authority used to validate TLS connections to the controller.
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
				if (err instanceof libErrors.SessionLost) {
					return undefined;
				}

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
					logger.fatal(`Unexpected error reconnecting to controller:\n${err.stack}`);
					return this.shutdown();
				});

			} else {
				logger.fatal("Controller connection was unexpectedly closed");
				this.shutdown();
			}
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				let message = new libData.ControllerConnectionEvent(event);
				for (let instanceConnection of this.instanceConnections.values()) {
					instanceConnection.send(message);
				}
			});
		}

		this.handle(libData.SyncUserListsEvent, this.handleSyncUserListsEvent.bind(this));
		this.snoopEvent(libData.InstanceAdminlistUpdateEvent, this.handleAdminlistUpdateEvent.bind(this));
		this.snoopEvent(libData.InstanceBanlistUpdateEvent, this.handleBanlistUpdateEvent.bind(this));
		this.snoopEvent(libData.InstanceWhitelistUpdateEvent, this.handleWhitelistUpdateEvent.bind(this));
		this.handle(libData.InstanceAssignInternalRequest, this.handleInstanceAssignInternalRequest.bind(this));
		this.handle(libData.InstanceUnassignInternalRequest, this.handleInstanceUnassignInternalRequest.bind(this));
		this.handle(libData.HostMetricsRequest, this.handleHostMetricsRequest.bind(this));
		this.fallbackRequest(libData.InstanceListSavesRequest, this.fallbackInstanceListSavesRequest.bind(this));
		this.handle(libData.InstanceRenameSaveRequest, this.handleInstanceRenameSaveRequest.bind(this));
		this.handle(libData.InstanceCopySaveRequest, this.handleInstanceCopySaveRequest.bind(this));
		this.handle(libData.InstanceTransferSaveRequest, this.handleInstanceTransferSaveRequest.bind(this));
		this.handle(libData.InstanceDeleteSaveRequest, this.handleInstanceDeleteSaveRequest.bind(this));
		this.handle(libData.InstancePullSaveRequest, this.handleInstancePullSaveRequest.bind(this));
		this.handle(libData.InstancePushSaveRequest, this.handleInstancePushSaveRequest.bind(this));
		this.handle(libData.InstanceDeleteInternalRequest, this.handleInstanceDeleteInternalRequest.bind(this));
	}

	async _createNewInstanceDir(name) {
		name = libFileOps.cleanFilename(name);
		try {
			libFileOps.checkFilename(name);
		} catch (err) {
			throw new Error(`Instance folder was unepectedly invalid: name ${err.message}`);
		}

		let instancesDir = this.config.get("host.instances_directory");
		for (let i = 0; i < 10; i++) { // Limit attempts in case this is somehow an infinite loop
			let candidateDir = path.join(instancesDir, await libFileOps.findUnusedName(instancesDir, name));
			try {
				await fs.mkdir(candidateDir);
			} catch (err) {
				if (err.code === "EEXIST") {
					continue;
				}
				throw err;
			}
			return candidateDir;
		}
		throw Error("Unable to create instance dir, retry threshold reached");
	}

	async broadcastEventToInstance(event) {
		for (let instanceConnection of this.instanceConnections.values()) {
			if (event.constructor.plugin && !instanceConnection.plugins.has(event.plugin)) { continue; }
			instanceConnection.send(event);
		}
	}

	async handleSyncUserListsEvent(request) {
		let updateList = (list, updatedList, Event) => {
			let added = new Set(updatedList);
			let removed = new Set(list);
			list.forEach(el => added.delete(el));
			updatedList.forEach(el => removed.delete(el));

			for (let name of added) {
				list.add(name);
				this.broadcastEventToInstance(new Event(name, true));
			}

			for (let name of removed) {
				list.delete(name);
				this.broadcastEventToInstance(new Event(name, false));
			}
		};

		updateList(this.adminlist, request.adminlist, libData.InstanceAdminlistUpdateEvent);
		updateList(this.whitelist, request.whitelist, libData.InstanceWhitelistUpdateEvent);

		let addedOrChanged = new Map(request.banlist);
		let removed = new Set(this.banlist.keys());
		addedOrChanged.forEach((_, name) => removed.delete(name));
		this.banlist.forEach((reason, name) => {
			if (addedOrChanged.get(name) === reason) {
				addedOrChanged.delete(name);
			}
		});

		for (let [name, reason] of addedOrChanged) {
			this.banlist.set(name, reason);
			this.broadcastEventToInstance(new libData.InstanceBanlistUpdateEvent(name, true, reason));
		}

		for (let name of removed) {
			this.banlist.delete(name);
			this.broadcastEventToInstance(new libData.InstanceBanlistUpdateEvent(name, false, ""));
		}
	}

	async handleAdminlistUpdateEvent(request) {
		let { name, admin } = request;
		if (admin) {
			this.adminlist.add(name);
		} else {
			this.adminlist.delete(name);
		}
	}

	async handleBanlistUpdateEvent(request) {
		let { name, banned, reason } = request;
		if (banned) {
			this.banlist.set(name, reason);
		} else {
			this.banlist.delete(name);
		}
	}

	async handleWhitelistUpdateEvent(request) {
		let { name, whitelisted } = request;
		if (whitelisted) {
			this.whitelist.add(name);
		} else {
			this.whitelist.delete(name);
		}
	}

	async handleInstanceAssignInternalRequest(request) {
		let { instanceId, config } = request;
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (instanceInfo) {
			instanceInfo.config.update(config, true, "controller");
			logger.verbose(`Updated config for ${instanceInfo.path}`, this.instanceLogMeta(instanceId, instanceInfo));

		} else {
			instanceInfo = this.discoveredInstanceInfos.get(instanceId);
			if (instanceInfo) {
				instanceInfo.config.update(config, true, "controller");

			} else {
				let instanceConfig = new libConfig.InstanceConfig("host");
				await instanceConfig.load(config, "controller");

				let instanceDir = await this._createNewInstanceDir(instanceConfig.get("instance.name"));

				logger.info(`Creating ${instanceDir}`);
				await Instance.create(instanceDir, this.config.get("host.factorio_directory"));
				instanceInfo = {
					path: instanceDir,
					config: instanceConfig,
				};

				this.discoveredInstanceInfos.set(instanceId, instanceInfo);
			}

			this.instanceInfos.set(instanceId, instanceInfo);
			logger.verbose(`assigned instance ${instanceInfo.config.get("instance.name")}`);
		}

		// Somewhat hacky, but in the event of a lost session the status is
		// resent on assigment since the controller sends an assigment
		// request for all the instances it knows should be on this host.
		let instanceConnection = this.instanceConnections.get(instanceId);
		this.send(
			new libData.InstanceStatusChangedEvent(
				instanceId, instanceConnection ? instanceConnection.status : "stopped", null
			)
		);

		// save a copy of the instance config
		let warnedOutput = {
			_warning: "Changes to this file will be overwritten by the controller's copy.",
			...instanceInfo.config.serialize(),
		};
		await libFileOps.safeOutputFile(
			path.join(instanceInfo.path, "instance.json"),
			JSON.stringify(warnedOutput, null, 4)
		);
	}

	async handleInstanceUnassignInternalRequest(request) {
		let instanceId = request.instanceId;
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (instanceInfo) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			if (instanceConnection && ["starting", "running"].includes(instanceConnection.status)) {
				await instanceConnection.send(new libData.InstanceStopRequest());
			}

			this.instanceInfos.delete(instanceId);
			logger.verbose(`unassigned instance ${instanceInfo.config.get("instance.name")}`);
		}
	}

	instanceLogMeta(instanceId, instanceInfo) {
		instanceInfo = instanceInfo || this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			return { instance_id: instanceId, instance_name: String(instanceId) };
		}
		return { instance_id: instanceId, instance_name: instanceInfo.config.get("instance.name") };
	}

	getRequestInstanceInfo(instanceId) {
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} does not exist`);
		}
		return instanceInfo;
	}

	/**
	 * Initialize and connect an unloaded instance
	 *
	 * @param {number} instanceId - ID of instance to initialize.
	 * @returns {Promise<module:host/host~InstanceConnection>} connection to instance.
	 */
	async _connectInstance(instanceId) {
		let instanceInfo = this.getRequestInstanceInfo(instanceId);
		if (this.instanceConnections.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let hostAddress = new libData.Address(libData.Address.host, this.id);
		let instanceAddress = new libData.Address(libData.Address.instance, instanceId);
		let [connectionClient, connectionServer] = libLink.VirtualConnector.makePair(instanceAddress, hostAddress);
		let instanceConnection = new InstanceConnection(connectionServer, this, instanceId);
		let instance = new Instance(
			this, connectionClient, instanceInfo.path, this.config.get("host.factorio_directory"), instanceInfo.config
		);

		this.instanceConnections.set(instanceId, instanceConnection);
		await instance.init(this.pluginInfos);

		return instanceConnection;
	}

	async handleHostMetricsRequest() {
		let requests = [];
		for (let instanceConnection of this.instanceConnections.values()) {
			requests.push(instanceConnection.send(new libData.InstanceMetricsRequest()));
		}

		let results = [];
		for (let response of await Promise.all(requests)) {
			results.push(...response.results);
		}

		for await (let result of libPrometheus.defaultRegistry.collect()) {
			if (result.metric.name.startsWith("process_")) {
				results.push(libPrometheus.serializeResult(result, {
					addLabels: { "host_id": String(this.config.get("host.id")) },
					metricName: result.metric.name.replace("process_", "clusterio_host_"),
				}));

			} else {
				results.push(libPrometheus.serializeResult(result));
			}
		}

		return { results };
	}

	async fallbackInstanceListSavesRequest(request, src, dst) {
		let instanceInfo = this.getRequestInstanceInfo(dst.id);
		return await Instance.listSaves(path.join(instanceInfo.path, "saves"), null);
	}

	async handleInstanceRenameSaveRequest(request) {
		let { instanceId, oldName, newName } = request;
		checkRequestSaveName(oldName);
		checkRequestSaveName(newName);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);
		try {
			await fs.move(
				path.join(instanceInfo.path, "saves", oldName),
				path.join(instanceInfo.path, "saves", newName),
				{ overwrite: false },
			);
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${oldName} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstanceCopySaveRequest(request) {
		let { instanceId, source, destination } = request;
		checkRequestSaveName(source);
		checkRequestSaveName(destination);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);
		try {
			await fs.copy(
				path.join(instanceInfo.path, "saves", source),
				path.join(instanceInfo.path, "saves", destination),
				{ overwrite: false, errorOnExist: true },
			);
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${source} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstanceTransferSaveRequest(request) {
		let { sourceName, targetName, copy, sourceInstanceId, targetInstanceId } = request;
		checkRequestSaveName(sourceName);
		checkRequestSaveName(targetName);
		let sourceInstanceInfo = this.getRequestInstanceInfo(sourceInstanceId);
		let targetInstanceInfo = this.getRequestInstanceInfo(targetInstanceId);

		// For consistency with remote transfer initiated through pullSave the
		// target is renamed if it already exists.
		targetName = await libFileOps.findUnusedName(
			path.join(targetInstanceInfo.path, "saves"), targetName, ".zip"
		);

		try {
			if (copy) {
				await fs.copy(
					path.join(sourceInstanceInfo.path, "saves", sourceName),
					path.join(targetInstanceInfo.path, "saves", targetName),
					{ overwrite: true },
				);
			} else {
				await fs.move(
					path.join(sourceInstanceInfo.path, "saves", sourceName),
					path.join(targetInstanceInfo.path, "saves", targetName),
					{ overwrite: true },
				);
			}
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${sourceName} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(sourceInstanceId, path.join(sourceInstanceInfo.path, "saves"));
		await this.sendSaveListUpdate(targetInstanceId, path.join(targetInstanceInfo.path, "saves"));

		return targetName;
	}

	async sendSaveListUpdate(instanceId, savesDir) {
		let instanceConnection = this.instanceConnections.get(instanceId);
		let saveList;
		if (instanceConnection) {
			saveList = await instanceConnection.send(new libData.InstanceListSavesRequest());
		} else {
			saveList = await Instance.listSaves(savesDir, null);
		}

		this.send(new libData.InstanceSaveListUpdateEvent(instanceId, saveList));
	}

	async handleInstanceDeleteSaveRequest(request) {
		let { instanceId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		try {
			await fs.unlink(path.join(instanceInfo.path, "saves", name));
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${name} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstancePullSaveRequest(request) {
		let { instanceId, streamId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		let url = new URL(this.config.get("host.controller_url"));
		url.pathname += `api/stream/${streamId}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: this.tlsCa },
			stream: true,
		});

		if (response.statusCode !== 200) {
			let content = await libHelpers.readStream(response);
			throw new libErrors.RequestError(`Stream returned ${response.statusCode}: ${content.toString()}`);
		}

		let savesDir = path.join(instanceInfo.path, "saves");
		let tempFilename = name.replace(/(\.zip)?$/, ".tmp.zip");
		let writeStream;
		while (true) {
			try {
				writeStream = fs.createWriteStream(path.join(savesDir, tempFilename), { flags: "wx" });
				await events.once(writeStream, "open");
				break;
			} catch (err) {
				if (err.code === "EEXIST") {
					tempFilename = await libFileOps.findUnusedName(savesDir, tempFilename, ".tmp.zip");
				} else {
					throw err;
				}
			}
		}
		response.pipe(writeStream);
		await finished(writeStream);

		name = await libFileOps.findUnusedName(savesDir, name, ".zip");
		await fs.rename(path.join(savesDir, tempFilename), path.join(savesDir, name));

		await this.sendSaveListUpdate(instanceId, savesDir);
		return name;
	}

	async handleInstancePushSaveRequest(request) {
		let { instanceId, streamId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		let content;
		try {
			// phin doesn't support streaming requests :(
			content = await fs.readFile(path.join(instanceInfo.path, "saves", name));
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${name} does not exist`);
			}
			throw err;
		}

		let url = new URL(this.config.get("host.controller_url"));
		url.pathname += `api/stream/${streamId}`;
		phin({
			url, method: "PUT",
			core: { ca: this.tlsCa },
			data: content,
		}).catch(err => {
			logger.error(`Error pushing save to controller:\n${err.stack}`, this.instanceLogMeta(instanceId));
		});
	}

	async stopInstance(instanceId) {
		let instanceConnection = this.instanceConnections.get(instanceId);
		await instanceConnection.send(new libData.InstanceStopRequest());
	}

	async handleInstanceDeleteInternalRequest(request) {
		let instanceId = request.instanceId;
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
	 * the host and controller with the new list of instances.
	 */
	async updateInstances() {
		this.discoveredInstanceInfos = await discoverInstances(this.config.get("host.instances_directory"));
		let list = [];
		for (let [instanceId, instanceInfo] of this.discoveredInstanceInfos) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			list.push(new libData.RawInstanceInfo(
				instanceInfo.config.serialize("controller"),
				instanceConnection ? instanceConnection.status : "stopped",
			));
		}
		await this.send(new libData.InstancesUpdateRequest(list));

		// Handle configured auto startup instances
		if (this._startup) {
			this._startup = false;

			for (let [instanceId, instanceInfo] of this.instanceInfos) {
				if (instanceInfo.config.get("instance.auto_start")) {
					try {
						let instanceConnection = await this._connectInstance(instanceId);
						await instanceConnection.send(new libData.InstanceStartRequest(null));
					} catch (err) {
						logger.error(
							`Error during auto startup for ${instanceInfo.config.get("instance.name")}:\n${err.stack}`,
							this.instanceLogMeta(instanceId, instanceInfo)
						);
					}
				}
			}
		}
	}

	async prepareDisconnect() {
		for (let instanceConnection of this.instanceConnections.values()) {
			await instanceConnection.send(new libData.PrepareControllerDisconnectRequest());
		}
		this._disconnecting = true;
		return await super.prepareDisconnect();
	}

	/**
	 * Stops all instances and closes the connection
	 */
	async shutdown() {
		if (this._shuttingDown) {
			return;
		}
		this._shuttingDown = true;

		for (let instanceId of this.instanceConnections.keys()) {
			try {
				await this.stopInstance(instanceId);
			} catch (err) {
				logger.error(`Unexpected error stopping instance:\n${err.stack}`);
			}
		}

		try {
			await this.connector.disconnect();
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				logger.error(`Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		try {
			// Clear silly interval in pidfile library.
			pidusage.clear();
		} catch (err) {
			setBlocking(true);
			logger.error(`
+------------------------------------------------------------+
| Unexpected error occured while shutting down host, please  |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		}
	}

	/**
	 * True if the connection to the controller is connected, not in the dropped
	 * state,and not in the process of disconnecting.
	 * @type {boolean}
	 */
	get connected() {
		return !this._disconnecting && this.connector.connected;
	}
}

module.exports = Host;

// For testing only
module.exports._discoverInstances = discoverInstances;

