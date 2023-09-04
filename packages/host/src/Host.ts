"use strict";
import fs from "fs-extra";
import path from "path";
import events from "events";
import pidusage from "pidusage";
import setBlocking from "set-blocking";
import phin from "phin";
import stream from "stream";
import util from "util";

// internal libraries
import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

import type { HostConnector } from "../host";
import Instance from "./Instance";
import InstanceConnection from "./InstanceConnection";

const finished = util.promisify(stream.finished);


function checkRequestSaveName(name: string) {
	try {
		lib.checkFilename(name);
	} catch (err: any) {
		throw new lib.RequestError(`Save name ${err.message}`);
	}
}

/**
 * Searches for instances in the provided directory
 *
 * Looks through all sub-dirs of the provided directory for valid
 * instance definitions and return a mapping of instance id to
 * instanceInfo objects.
 *
 * @param instancesDir - Directory containing instances
 * @returns
 *     mapping between instance id and information about this instance.
 * @internal
 */
async function discoverInstances(instancesDir: string) {
	let instanceInfos = new Map<number, { path: string, config: lib.InstanceConfig }>();
	for (let entry of await fs.readdir(instancesDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			let instanceConfig = new lib.InstanceConfig("host");
			let configPath = path.join(instancesDir, entry.name, "instance.json");

			try {
				await instanceConfig.load(JSON.parse(await fs.readFile(configPath, "utf8")));

			} catch (err: any) {
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
	lib.InstanceStartRequest.name,
	lib.InstanceLoadScenarioRequest.name,
	lib.InstanceCreateSaveRequest.name,
	lib.InstanceExportDataRequest.name,
]);

class HostRouter {
	constructor(
		public host: Host
	) { }

	/**
	 * Forward a message to the next hop towards its destination.
	 *
	 * @param origin -
	 *    Link the message originated from.
	 * @param message - Message to process.
	 * @param hasFallback - is fallback available
	 * @returns true if the message was handled, false if fallback
	 *     is requested
	 */
	forwardMessage(origin: lib.Link, message: lib.MessageRoutable, hasFallback: boolean) {
		let dst = message.dst;
		let nextHop: lib.Link | undefined;
		let msg: string | undefined;
		if (dst.type === lib.Address.broadcast) {
			this.broadcastMessage(origin, message);
			return true;
		} else if (
			dst.type === lib.Address.controller
			|| dst.type === lib.Address.control
			|| dst.type === lib.Address.host && dst.id !== this.host.config.get("host.id")
			|| dst.type === lib.Address.instance && !this.host.instanceInfos.has(dst.id)
		) {
			nextHop = this.host;
		} else if (dst.type === lib.Address.instance && this.host.instanceInfos.has(dst.id)) {
			nextHop = this.host.instanceConnections.get(dst.id)!;
		}

		if (nextHop === origin) {
			msg = `Message would return back to sender ${origin.connector.dst}.`;
			nextHop = undefined;
		}

		if (message.type === "request") {
			if (
				dst.type === lib.Address.instance
				&& instanceStartingMessages.has((message as lib.MessageRequest).name)
			) {
				this.wakeInstance(origin, message, nextHop);
				return true;

			} else if (!nextHop) {
				if (dst.type === lib.Address.instance) {
					if (hasFallback) {
						return false;
					}
					origin.connector.sendResponseError(
						new lib.ResponseError("Instance is not running."), message.src
					);
				}
				return true;
			}

			// XXX What if the session is invalidated and there is no
			// response?  Need to track pending requests here.
		}

		if (nextHop) {
			this.sendMessage(nextHop, message, origin);
		} else {
			this.warnUnrouted(message, msg);
		}

		return true;
	}

	broadcastMessage(origin: lib.Link, message: lib.MessageRoutable) {
		let dst = message.dst;
		if (message.type !== "event") {
			this.warnUnrouted(message, `Unexpected broadcast of ${message.type}`);
		} else if (dst.id === lib.Address.host || dst.id === lib.Address.instance) {
			for (let instanceConnection of this.host.instanceConnections.values()) {
				if (instanceConnection !== origin) {
					instanceConnection.connector.send(message);
				}
			}
			if (this.host !== origin) {
				this.host.connector.send(message);
			}
		} else if (dst.id === lib.Address.control) {
			if (this.host !== origin) {
				this.host.connector.send(message);
			} else {
				logger.warn(`Received control broadcast of ${(message as lib.MessageEvent).name} from master.`);
			}
		} else {
			this.warnUnrouted(message, `Unexpected broacdast target ${dst.id}`);
		}
	}

	wakeInstance(origin: lib.Link, message: lib.MessageRoutable, nextHop?: lib.Link) {
		let dst = message.dst;
		if (nextHop) {
			origin.connector.sendResponseError(
				new lib.ResponseError("Instance is already running."), message.src
			);
			return;
		}
		if (this.host._shuttingDown) {
			origin.connector.sendResponseError(
				new lib.ResponseError("Host is shutting down."), message.src
			);
			return;
		}

		this.host._connectInstance(dst.id).then(instanceConnection => {
			instanceConnection.connector.send(message);
		}).catch(err => {
			logger.error(`Error starting instance:\n${err.stack}`, this.host.instanceLogMeta(dst.id));
			origin.connector.sendResponseError(
				new lib.ResponseError(err.message, err.code, err.stack), message.src
			);
		});
	}

	sendMessage(nextHop: lib.Link, message: lib.MessageRoutable, origin: lib.Link) {
		try {
			if (message.type === "request") {
				nextHop.forwardRequest(message as lib.MessageRequest, origin);
			} else {
				nextHop.connector.send(message);
			}
		} catch (err: any) {
			if (message.type === "request") {
				origin.connector.sendResponseError(
					new lib.ResponseError(err.message, err.code, err.stack), message.src
				);
			}
			logger.warn(`Failed to deliver ${(message as any).name || "message"} (${message.type}): ${err.message}`);
		}
	}

	warnUnrouted(message: lib.MessageRoutable, msg?: string) {
		let dst = message.dst;
		let baseMsg = `No destination for ${message.constructor.name} routed from ${message.src} to ${dst}`;
		logger.warn(msg ? `${baseMsg}: ${msg}.` : `${baseMsg}.`);
	}
}

/**
 * Handles running the host
 *
 * Connects to the controller over the WebSocket and manages intsances.
 */
export default class Host extends lib.Link {
	declare ["connector"]: HostConnector;

	router = new HostRouter(this);
	/**
	 * Certificate authority used to validate TLS connections to the controller.
	 */
	tlsCa?: string;
	pluginInfos: lib.PluginNodeEnvInfo[];
	config: lib.HostConfig;

	instanceConnections = new Map<number, InstanceConnection>();
	discoveredInstanceInfos = new Map<number, { path: string, config: lib.InstanceConfig }>();
	instanceInfos = new Map<number, { path: string, config: lib.InstanceConfig }>();

	adminlist = new Set<string>();
	banlist = new Map<string, string>();
	whitelist = new Set<string>();

	serverVersion = "unknown";
	serverPlugins = new Map<string, string>();

	_startup = true;
	_disconnecting = false;
	_shuttingDown = false;

	constructor(
		connector: HostConnector,
		hostConfig: lib.HostConfig,
		tlsCa: string | undefined,
		pluginInfos: lib.PluginNodeEnvInfo[]
	) {
		super(connector);
		this.tlsCa = tlsCa;

		this.pluginInfos = pluginInfos;
		this.config = hostConfig;

		this.connector.on("hello", data => {
			this.serverVersion = data.version;
			this.serverPlugins = new Map(Object.entries(data.plugins));
		});

		this.connector.on("connect", () => {
			if (this._shuttingDown) {
				return;
			}

			this.updateInstances().catch((err) => {
				if (err instanceof lib.SessionLost) {
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
				let message = new lib.ControllerConnectionEvent(event);
				for (let instanceConnection of this.instanceConnections.values()) {
					instanceConnection.send(message);
				}
			});
		}

		this.handle(lib.SyncUserListsEvent, this.handleSyncUserListsEvent.bind(this));
		this.snoopEvent(lib.InstanceAdminlistUpdateEvent, this.handleAdminlistUpdateEvent.bind(this));
		this.snoopEvent(lib.InstanceBanlistUpdateEvent, this.handleBanlistUpdateEvent.bind(this));
		this.snoopEvent(lib.InstanceWhitelistUpdateEvent, this.handleWhitelistUpdateEvent.bind(this));
		this.handle(lib.InstanceAssignInternalRequest, this.handleInstanceAssignInternalRequest.bind(this));
		this.handle(lib.InstanceUnassignInternalRequest, this.handleInstanceUnassignInternalRequest.bind(this));
		this.handle(lib.HostMetricsRequest, this.handleHostMetricsRequest.bind(this));
		this.fallbackRequest(lib.InstanceListSavesRequest, this.fallbackInstanceListSavesRequest.bind(this));
		this.handle(lib.InstanceRenameSaveRequest, this.handleInstanceRenameSaveRequest.bind(this));
		this.handle(lib.InstanceCopySaveRequest, this.handleInstanceCopySaveRequest.bind(this));
		this.handle(lib.InstanceTransferSaveRequest, this.handleInstanceTransferSaveRequest.bind(this));
		this.handle(lib.InstanceDeleteSaveRequest, this.handleInstanceDeleteSaveRequest.bind(this));
		this.handle(lib.InstancePullSaveRequest, this.handleInstancePullSaveRequest.bind(this));
		this.handle(lib.InstancePushSaveRequest, this.handleInstancePushSaveRequest.bind(this));
		this.handle(lib.InstanceDeleteInternalRequest, this.handleInstanceDeleteInternalRequest.bind(this));
	}

	async _createNewInstanceDir(name: string) {
		name = lib.cleanFilename(name);
		try {
			lib.checkFilename(name);
		} catch (err: any) {
			throw new Error(`Instance folder was unepectedly invalid: name ${err.message}`);
		}

		let instancesDir = this.config.get("host.instances_directory");
		for (let i = 0; i < 10; i++) { // Limit attempts in case this is somehow an infinite loop
			let candidateDir = path.join(instancesDir, await lib.findUnusedName(instancesDir, name));
			try {
				await fs.mkdir(candidateDir);
			} catch (err: any) {
				if (err.code === "EEXIST") {
					continue;
				}
				throw err;
			}
			return candidateDir;
		}
		throw Error("Unable to create instance dir, retry threshold reached");
	}

	async broadcastEventToInstance<T>(event: lib.Event<T>) {
		for (let instanceConnection of this.instanceConnections.values()) {
			if (event.constructor.plugin && !instanceConnection.plugins.has(event.constructor.plugin)) {
				continue;
			}
			instanceConnection.send(event);
		}
	}

	async handleSyncUserListsEvent(event: lib.SyncUserListsEvent) {
		let updateList = <T extends lib.Event<T>>(list: Set<string>, updatedList: Set<string>, Event: lib.EventClass<T>) => {
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

		updateList(this.adminlist, event.adminlist, lib.InstanceAdminlistUpdateEvent);
		updateList(this.whitelist, event.whitelist, lib.InstanceWhitelistUpdateEvent);

		let addedOrChanged = new Map(event.banlist);
		let removed = new Set(this.banlist.keys());
		addedOrChanged.forEach((_, name) => removed.delete(name));
		this.banlist.forEach((reason, name) => {
			if (addedOrChanged.get(name) === reason) {
				addedOrChanged.delete(name);
			}
		});

		for (let [name, reason] of addedOrChanged) {
			this.banlist.set(name, reason);
			this.broadcastEventToInstance(new lib.InstanceBanlistUpdateEvent(name, true, reason));
		}

		for (let name of removed) {
			this.banlist.delete(name);
			this.broadcastEventToInstance(new lib.InstanceBanlistUpdateEvent(name, false, ""));
		}
	}

	async handleAdminlistUpdateEvent(event: lib.InstanceAdminlistUpdateEvent) {
		let { name, admin } = event;
		if (admin) {
			this.adminlist.add(name);
		} else {
			this.adminlist.delete(name);
		}
	}

	async handleBanlistUpdateEvent(event: lib.InstanceBanlistUpdateEvent) {
		let { name, banned, reason } = event;
		if (banned) {
			this.banlist.set(name, reason);
		} else {
			this.banlist.delete(name);
		}
	}

	async handleWhitelistUpdateEvent(event: lib.InstanceWhitelistUpdateEvent) {
		let { name, whitelisted } = event;
		if (whitelisted) {
			this.whitelist.add(name);
		} else {
			this.whitelist.delete(name);
		}
	}

	async handleInstanceAssignInternalRequest(request: lib.InstanceAssignInternalRequest) {
		let { instanceId, config } = request;
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (instanceInfo) {
			instanceInfo.config.update(config as any, true, "controller");
			logger.verbose(`Updated config for ${instanceInfo.path}`, this.instanceLogMeta(instanceId, instanceInfo));

		} else {
			instanceInfo = this.discoveredInstanceInfos.get(instanceId);
			if (instanceInfo) {
				instanceInfo.config.update(config as any, true, "controller");

			} else {
				let instanceConfig = new lib.InstanceConfig("host");
				await instanceConfig.load(config as any, "controller");

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
			new lib.InstanceStatusChangedEvent(
				instanceId, instanceConnection ? instanceConnection.status : "stopped", undefined
			)
		);

		// save a copy of the instance config
		let warnedOutput = {
			_warning: "Changes to this file will be overwritten by the controller's copy.",
			...instanceInfo.config.serialize(),
		};
		await lib.safeOutputFile(
			path.join(instanceInfo.path, "instance.json"),
			JSON.stringify(warnedOutput, null, 4)
		);
	}

	async handleInstanceUnassignInternalRequest(request: lib.InstanceUnassignInternalRequest) {
		let instanceId = request.instanceId;
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (instanceInfo) {
			let instanceConnection = this.instanceConnections.get(instanceId);
			if (instanceConnection && ["starting", "running"].includes(instanceConnection.status)) {
				await instanceConnection.send(new lib.InstanceStopRequest());
			}

			this.instanceInfos.delete(instanceId);
			logger.verbose(`unassigned instance ${instanceInfo.config.get("instance.name")}`);
		}
	}

	instanceLogMeta(instanceId: number, instanceInfo?: { config: lib.InstanceConfig }) {
		instanceInfo = instanceInfo || this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			return { instance_id: instanceId, instance_name: String(instanceId) };
		}
		return { instance_id: instanceId, instance_name: instanceInfo.config.get("instance.name") };
	}

	getRequestInstanceInfo(instanceId: number) {
		let instanceInfo = this.instanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new lib.RequestError(`Instance with ID ${instanceId} does not exist`);
		}
		return instanceInfo;
	}

	/**
	 * Initialize and connect an unloaded instance
	 *
	 * @param instanceId - ID of instance to initialize.
	 * @returns connection to instance.
	 */
	async _connectInstance(instanceId: number) {
		let instanceInfo = this.getRequestInstanceInfo(instanceId);
		if (this.instanceConnections.has(instanceId)) {
			throw new lib.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let hostAddress = new lib.Address(lib.Address.host, this.config.get("host.id"));
		let instanceAddress = new lib.Address(lib.Address.instance, instanceId);
		let [connectionClient, connectionServer] = lib.VirtualConnector.makePair(instanceAddress, hostAddress);
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
			requests.push(instanceConnection.send(new lib.InstanceMetricsRequest()));
		}

		let results = [];
		for (let response of await Promise.all(requests)) {
			results.push(...response.results);
		}

		for await (let result of lib.defaultRegistry.collect()) {
			if (result.metric.name.startsWith("process_")) {
				results.push(lib.serializeResult(result, {
					addLabels: { "host_id": String(this.config.get("host.id")) },
					metricName: result.metric.name.replace("process_", "clusterio_host_"),
				}));

			} else {
				results.push(lib.serializeResult(result));
			}
		}

		return { results };
	}

	async fallbackInstanceListSavesRequest(request: lib.InstanceListSavesRequest, src: lib.Address, dst: lib.Address) {
		let instanceInfo = this.getRequestInstanceInfo(dst.id);
		return await Instance.listSaves(path.join(instanceInfo.path, "saves"), null);
	}

	async handleInstanceRenameSaveRequest(request: lib.InstanceRenameSaveRequest) {
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
		} catch (err: any) {
			if (err.code === "ENOENT") {
				throw new lib.RequestError(`${oldName} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstanceCopySaveRequest(request: lib.InstanceCopySaveRequest) {
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
		} catch (err: any) {
			if (err.code === "ENOENT") {
				throw new lib.RequestError(`${source} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstanceTransferSaveRequest(request: lib.InstanceTransferSaveRequest) {
		let { sourceName, targetName, copy, sourceInstanceId, targetInstanceId } = request;
		checkRequestSaveName(sourceName);
		checkRequestSaveName(targetName);
		let sourceInstanceInfo = this.getRequestInstanceInfo(sourceInstanceId);
		let targetInstanceInfo = this.getRequestInstanceInfo(targetInstanceId);

		// For consistency with remote transfer initiated through pullSave the
		// target is renamed if it already exists.
		targetName = await lib.findUnusedName(
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
		} catch (err: any) {
			if (err.code === "ENOENT") {
				throw new lib.RequestError(`${sourceName} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(sourceInstanceId, path.join(sourceInstanceInfo.path, "saves"));
		await this.sendSaveListUpdate(targetInstanceId, path.join(targetInstanceInfo.path, "saves"));

		return targetName;
	}

	async sendSaveListUpdate(instanceId: number, savesDir: string) {
		let instanceConnection = this.instanceConnections.get(instanceId);
		let saveList: lib.SaveDetails[];
		if (instanceConnection) {
			saveList = await instanceConnection.send(new lib.InstanceListSavesRequest());
		} else {
			saveList = await Instance.listSaves(savesDir, null);
		}

		this.send(new lib.InstanceSaveListUpdateEvent(instanceId, saveList));
	}

	async handleInstanceDeleteSaveRequest(request: lib.InstanceDeleteSaveRequest) {
		let { instanceId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		try {
			await fs.unlink(path.join(instanceInfo.path, "saves", name));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				throw new lib.RequestError(`${name} does not exist`);
			}
			throw err;
		}
		await this.sendSaveListUpdate(instanceId, path.join(instanceInfo.path, "saves"));
	}

	async handleInstancePullSaveRequest(request: lib.InstancePullSaveRequest) {
		let { instanceId, streamId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		let url = new URL(this.config.get("host.controller_url"));
		url.pathname += `api/stream/${streamId}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: this.tlsCa } as {},
			stream: true,
		});

		if (response.statusCode !== 200) {
			let content = await lib.readStream(response);
			throw new lib.RequestError(`Stream returned ${response.statusCode}: ${content.toString()}`);
		}

		let savesDir = path.join(instanceInfo.path, "saves");
		let tempFilename = name.replace(/(\.zip)?$/, ".tmp.zip");
		let writeStream: NodeJS.WritableStream;
		while (true) {
			try {
				writeStream = fs.createWriteStream(path.join(savesDir, tempFilename), { flags: "wx" });
				await events.once(writeStream, "open");
				break;
			} catch (err: any) {
				if (err.code === "EEXIST") {
					tempFilename = await lib.findUnusedName(savesDir, tempFilename, ".tmp.zip");
				} else {
					throw err;
				}
			}
		}
		response.pipe(writeStream);
		await finished(writeStream);

		name = await lib.findUnusedName(savesDir, name, ".zip");
		await fs.rename(path.join(savesDir, tempFilename), path.join(savesDir, name));

		await this.sendSaveListUpdate(instanceId, savesDir);
		return name;
	}

	async handleInstancePushSaveRequest(request: lib.InstancePushSaveRequest) {
		let { instanceId, streamId, name } = request;
		checkRequestSaveName(name);
		let instanceInfo = this.getRequestInstanceInfo(instanceId);

		let content: Buffer;
		try {
			// phin doesn't support streaming requests :(
			content = await fs.readFile(path.join(instanceInfo.path, "saves", name));
		} catch (err: any) {
			if (err.code === "ENOENT") {
				throw new lib.RequestError(`${name} does not exist`);
			}
			throw err;
		}

		let url = new URL(this.config.get("host.controller_url"));
		url.pathname += `api/stream/${streamId}`;
		phin({
			url, method: "PUT",
			core: { ca: this.tlsCa } as {},
			data: content,
		}).catch(err => {
			logger.error(`Error pushing save to controller:\n${err.stack}`, this.instanceLogMeta(instanceId));
		});
	}

	async stopInstance(instanceId: number) {
		let instanceConnection = this.instanceConnections.get(instanceId);
		if (instanceConnection) {
			await instanceConnection.send(new lib.InstanceStopRequest());
		}
	}

	async handleInstanceDeleteInternalRequest(request: lib.InstanceDeleteInternalRequest) {
		let instanceId = request.instanceId;
		if (this.instanceConnections.has(instanceId)) {
			throw new lib.RequestError(`Instance with ID ${instanceId} is running`);
		}

		let instanceInfo = this.discoveredInstanceInfos.get(instanceId);
		if (!instanceInfo) {
			throw new lib.RequestError(`Instance with ID ${instanceId} does not exist`);
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
			list.push(new lib.RawInstanceInfo(
				instanceInfo.config.serialize("controller"),
				instanceConnection ? instanceConnection.status : "stopped",
			));
		}
		await this.send(new lib.InstancesUpdateRequest(list));

		// Handle configured auto startup instances
		if (this._startup) {
			this._startup = false;

			for (let [instanceId, instanceInfo] of this.instanceInfos) {
				if (instanceInfo.config.get("instance.auto_start")) {
					try {
						let instanceConnection = await this._connectInstance(instanceId);
						await instanceConnection.send(new lib.InstanceStartRequest());
					} catch (err: any) {
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
			await instanceConnection.send(new lib.PrepareControllerDisconnectRequest());
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
			} catch (err: any) {
				logger.error(`Unexpected error stopping instance:\n${err.stack}`);
			}
		}

		try {
			await this.connector.disconnect();
		} catch (err: any) {
			if (!(err instanceof lib.SessionLost)) {
				logger.error(`Unexpected error preparing disconnect:\n${err.stack}`);
			}
		}

		try {
			// Clear silly interval in pidfile library.
			pidusage.clear();
		} catch (err: any) {
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
	 */
	get connected() {
		return !this._disconnecting && this.connector.connected;
	}
}

// For testing only
export const _discoverInstances = discoverInstances;
