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

/**
 * Handles running the slave
 *
 * Connects to the master server over the WebSocket and manages intsances.
 * @alias module:slave/src/Slave
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

	async _createNewInstanceDir(name) {
		name = libFileOps.cleanFilename(name);
		try {
			libFileOps.checkFilename(name);
		} catch (err) {
			throw new Error(`Instance folder was unepectedly invalid: name ${err.message}`);
		}

		let instancesDir = this.config.get("slave.instances_directory");
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
			logger.verbose(`Updated config for ${instanceInfo.path}`, this.instanceLogMeta(instance_id, instanceInfo));

		} else {
			instanceInfo = this.discoveredInstanceInfos.get(instance_id);
			if (instanceInfo) {
				instanceInfo.config.update(serialized_config, true, "master");

			} else {
				let instanceConfig = new libConfig.InstanceConfig("slave");
				await instanceConfig.load(serialized_config, "master");

				let instanceDir = await this._createNewInstanceDir(instanceConfig.get("instance.name"));

				logger.info(`Creating ${instanceDir}`);
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
		await libFileOps.safeOutputFile(
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
	 * @returns {Promise<module:slave/slave~InstanceConnection>} connection to instance.
	 */
	async _connectInstance(instanceId) {
		let instanceInfo = this.getRequestInstanceInfo(instanceId);
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
		try {
			let instanceConnection = await this._connectInstance(instanceId);
			return await request.send(instanceConnection, message.data);
		} catch (err) {
			if (!(err instanceof libErrors.RequestError)) {
				logger.error(`Error starting instance:\n${err.stack}`, this.instanceLogMeta(instanceId));
				throw new libErrors.RequestError(err.message);
			}
			throw err;
		}
	}

	async loadScenarioRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		try {
			let instanceConnection = await this._connectInstance(instanceId);
			return await request.send(instanceConnection, message.data);
		} catch (err) {
			if (!(err instanceof libErrors.RequestError)) {
				logger.error(`Error starting instance:\n${err.stack}`, this.instanceLogMeta(instanceId));
				throw new libErrors.RequestError(err.message);
			}
			throw err;
		}
	}

	async listSavesRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		let instanceConnection = this.instanceConnections.get(instanceId);
		if (instanceConnection) {
			return await request.send(instanceConnection, message.data);
		}

		let instanceInfo = this.getRequestInstanceInfo(instanceId);
		return {
			list: await Instance.listSaves(path.join(instanceInfo.path, "saves"), null),
		};
	}

	async createSaveRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		try {
			let instanceConnection = await this._connectInstance(instanceId);
			await request.send(instanceConnection, message.data);
		} catch (err) {
			if (!(err instanceof libErrors.RequestError)) {
				logger.error(`Error creating save:\n${err.stack}`, this.instanceLogMeta(instanceId));
				throw new libErrors.RequestError(err.message);
			}
			throw err;
		}
	}

	async renameSaveRequestHandler(message) {
		let { instance_id, old_name, new_name } = message.data;
		checkRequestSaveName(old_name);
		checkRequestSaveName(new_name);
		let instanceInfo = this.getRequestInstanceInfo(instance_id);
		try {
			await fs.move(
				path.join(instanceInfo.path, "saves", old_name),
				path.join(instanceInfo.path, "saves", new_name),
				{ overwrite: false },
			);
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${old_name} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instance_id, path.join(instanceInfo.path, "saves"));
	}

	async copySaveRequestHandler(message) {
		let { instance_id, source, destination } = message.data;
		checkRequestSaveName(source);
		checkRequestSaveName(destination);
		let instanceInfo = this.getRequestInstanceInfo(instance_id);
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
		await this.sendSaveListUpdate(instance_id, path.join(instanceInfo.path, "saves"));
	}

	async transferSaveRequestHandler(message) {
		let { source_save, target_save, copy, instance_id, target_instance_id } = message.data;
		checkRequestSaveName(source_save);
		checkRequestSaveName(target_save);
		let sourceInstanceInfo = this.getRequestInstanceInfo(instance_id);
		let targetInstanceInfo = this.getRequestInstanceInfo(target_instance_id);

		// For consistency with remote transfer initiated through pullSave the
		// target is renamed if it already exists.
		target_save = await libFileOps.findUnusedName(
			path.join(targetInstanceInfo.path, "saves"), target_save, ".zip"
		);

		try {
			if (copy) {
				await fs.copy(
					path.join(sourceInstanceInfo.path, "saves", source_save),
					path.join(targetInstanceInfo.path, "saves", target_save),
					{ overwrite: true },
				);
			} else {
				await fs.move(
					path.join(sourceInstanceInfo.path, "saves", source_save),
					path.join(targetInstanceInfo.path, "saves", target_save),
					{ overwrite: true },
				);
			}
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${source_save} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instance_id, path.join(sourceInstanceInfo.path, "saves"));
		await this.sendSaveListUpdate(target_instance_id, path.join(targetInstanceInfo.path, "saves"));

		return { save: target_save };
	}

	async sendSaveListUpdate(instance_id, savesDir) {
		let instanceConnection = this.instanceConnections.get(instance_id);
		let saveList;
		if (instanceConnection) {
			saveList = (await libLink.messages.listSaves.send(instanceConnection, { instance_id })).list;
		} else {
			saveList = await Instance.listSaves(savesDir, null);
		}

		libLink.messages.saveListUpdate.send(this, { instance_id, list: saveList });
	}

	async deleteSaveRequestHandler(message) {
		let { instance_id, save } = message.data;
		checkRequestSaveName(save);
		let instanceInfo = this.getRequestInstanceInfo(instance_id);

		try {
			await fs.unlink(path.join(instanceInfo.path, "saves", save));
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${save} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instance_id, path.join(instanceInfo.path, "saves"));
	}

	async pullSaveRequestHandler(message) {
		let { instance_id, stream_id, filename } = message.data;
		checkRequestSaveName(filename);
		let instanceInfo = this.getRequestInstanceInfo(instance_id);

		let url = new URL(this.config.get("slave.master_url"));
		url.pathname += `api/stream/${stream_id}`;
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
		let tempFilename = filename.replace(/(\.zip)?$/, ".tmp.zip");
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

		filename = await libFileOps.findUnusedName(savesDir, filename, ".zip");
		await fs.rename(path.join(savesDir, tempFilename), path.join(savesDir, filename));

		await this.sendSaveListUpdate(instance_id, savesDir);
		return { save: filename };
	}

	async pushSaveRequestHandler(message) {
		let { instance_id, stream_id, save } = message.data;
		checkRequestSaveName(save);
		let instanceInfo = this.getRequestInstanceInfo(instance_id);

		let content;
		try {
			// phin doesn't support streaming requests :(
			content = await fs.readFile(path.join(instanceInfo.path, "saves", save));
		} catch (err) {
			if (err.code === "ENOENT") {
				throw new libErrors.RequestError(`${save} does not exist`);
			}
			throw err;
		}

		let url = new URL(this.config.get("slave.master_url"));
		url.pathname += `api/stream/${stream_id}`;
		phin({
			url, method: "PUT",
			core: { ca: this.tlsCa },
			data: content,
		}).catch(err => logger.error(`Error pushing save to master:\n${err.stack}`, this.instanceLogMeta(instance_id)));
	}

	async exportDataRequestHandler(message, request) {
		let instanceId = message.data.instance_id;
		try {
			let instanceConnection = await this._connectInstance(instanceId);
			await request.send(instanceConnection, message.data);
		} catch (err) {
			if (!(err instanceof libErrors.RequestError)) {
				logger.error(`Error exporting data:\n${err.stack}`, this.instanceLogMeta(instanceId));
				throw new libErrors.RequestError(err.message);
			}
			throw err;
		}
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
							`Error during auto startup for ${instanceInfo.config.get("instance.name")}:\n${err.stack}`,
							this.instanceLogMeta(instanceId, instanceInfo)
						);
					}
				}
			}
		}
	}

	async prepareDisconnectRequestHandler(message, request) {
		for (let instanceConnection of this.instanceConnections.values()) {
			await libLink.messages.prepareMasterDisconnect.send(instanceConnection);
		}
		this._disconnecting = true;
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
			await this.connector.close(1000, "Slave Shutdown");

			// Clear silly interval in pidfile library.
			pidusage.clear();
		} catch (err) {
			setBlocking(true);
			logger.error(`
+------------------------------------------------------------+
| Unexpected error occured while shutting down slave, please |
| report it to https://github.com/clusterio/clusterio/issues |
+------------------------------------------------------------+
${err.stack}`
			);
			// eslint-disable-next-line node/no-process-exit
			process.exit(1);
		}
	}

	/**
	 * True if the connection to the master is connected, not in the dropped
	 * state,and not in the process of disconnecting.
	 * @type {boolean}
	 */
	get connected() {
		return !this._disconnecting && this.connector.connected;
	}
}

module.exports = Slave;

// For testing only
module.exports._discoverInstances = discoverInstances;

