import type WsServerConnector from "./WsServerConnector";
import type { HostInfo } from "./HostConnection";

import events from "events";
import fs from "fs-extra";
import path from "path";

import * as lib from "@clusterio/lib";
const { logFilter, logger } = lib;

import BaseConnection from "./BaseConnection";
import * as routes from "./routes";
import Controller from "./Controller";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

const queryLogTime = new lib.Summary(
	"clusterio_controller_query_log_duration_seconds",
	"Time in seconds log queries took to execute."
);

/**
 * Represents the connection to a control link
 *
 * @extends module:controller/src/BaseConnection
 * @alias module:controller/src/ControlConnection
 */
export default class ControlConnection extends BaseConnection {
	private _agent: string;
	private _version: string;
	logTransport: lib.LinkTransport | null = null;
	logSubscriptions: {
		all: boolean,
		controller: boolean,
		hostIds: number[],
		instanceIds: number[],
	} = {
		all: false,
		controller: false,
		hostIds: [],
		instanceIds: [],
	};
	ws_dumper: ((...args: any[]) => void) | null = null;
	declare connector: WsServerConnector;

	constructor(
		registerData: { agent:string, version:string },
		connector: WsServerConnector,
		controller: Controller,
		public user: lib.User, // The user making this connection.
		public id: number
	) {
		super(connector, controller);

		this._agent = registerData.agent;
		this._version = registerData.version;

		this.connector.on("connect", () => {
			this.connector._socket!.clusterio_ignore_dump = Boolean(this.ws_dumper);
		});
		this.connector.on("close", () => {
			if (this.logTransport) {
				logger.remove(this.logTransport);
				this.logTransport = null;
			}
			if (this.ws_dumper) {
				this._controller.debugEvents.off("message", this.ws_dumper);
			}
		});

		for (let event of ["connect", "drop", "resume", "close"] as const) {
			this.connector.on(event, () => {
				for (let controllerPlugin of this._controller.plugins.values()) {
					controllerPlugin.onControlConnectionEvent(this, event);
				}
			});
		}

		this.handle(lib.ControllerConfigGetRequest, this.handleControllerConfigGetRequest.bind(this));
		this.handle(lib.ControllerConfigSetFieldRequest, this.handleControllerConfigSetFieldRequest.bind(this));
		this.handle(lib.ControllerConfigSetPropRequest, this.handleControllerConfigSetPropRequest.bind(this));
		this.handle(lib.HostListRequest, this.handleHostListRequest.bind(this));
		this.handle(lib.HostGenerateTokenRequest, this.handleHostGenerateTokenRequest.bind(this));
		this.handle(lib.HostConfigCreateRequest, this.handleHostConfigCreateRequest.bind(this));
		this.handle(lib.InstanceDetailsGetRequest, this.handleInstanceDetailsGetRequest.bind(this));
		this.handle(lib.InstanceDetailsListRequest, this.handleInstanceDetailsListRequest.bind(this));
		this.handle(lib.InstanceCreateRequest, this.handleInstanceCreateRequest.bind(this));
		this.handle(lib.InstanceDeleteRequest, this.handleInstanceDeleteRequest.bind(this));
		this.handle(lib.InstanceConfigGetRequest, this.handleInstanceConfigGetRequest.bind(this));
		this.handle(lib.InstanceConfigSetFieldRequest, this.handleInstanceConfigSetFieldRequest.bind(this));
		this.handle(lib.InstanceConfigSetPropRequest, this.handleInstanceConfigSetPropRequest.bind(this));
		this.handle(lib.InstanceAssignRequest, this.handleInstanceAssignRequest.bind(this));
		this.handle(lib.InstanceRenameSaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller));
		this.handle(lib.InstanceCopySaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller));
		this.handle(lib.InstanceDeleteSaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller));
		this.handle(lib.InstanceDownloadSaveRequest, this.handleInstanceDownloadSaveRequest.bind(this));
		this.handle(lib.InstanceTransferSaveRequest, this.handleInstanceTransferSaveRequest.bind(this));
		this.handle(lib.ModPackListRequest, this.handleModPackListRequest.bind(this));
		this.handle(lib.ModPackCreateRequest, this.handleModPackCreateRequest.bind(this));
		this.handle(lib.ModPackUpdateRequest, this.handleModPackUpdateRequest.bind(this));
		this.handle(lib.ModPackDeleteRequest, this.handleModPackDeleteRequest.bind(this));
		this.handle(lib.ModGetRequest, this.handleModGetRequest.bind(this));
		this.handle(lib.ModListRequest, this.handleModListRequest.bind(this));
		this.handle(lib.ModSearchRequest, this.handleModSearchRequest.bind(this));
		this.handle(lib.ModDownloadRequest, this.handleModDownloadRequest.bind(this));
		this.handle(lib.ModDeleteRequest, this.handleModDeleteRequest.bind(this));
		this.handle(lib.LogSetSubscriptionsRequest, this.handleLogSetSubscriptionsRequest.bind(this));
		this.handle(lib.LogQueryRequest, this.handleLogQueryRequest.bind(this));
		this.handle(lib.PermissionListRequest, this.handlePermissionListRequest.bind(this));
		this.handle(lib.RoleListRequest, this.handleRoleListRequest.bind(this));
		this.handle(lib.RoleCreateRequest, this.handleRoleCreateRequest.bind(this));
		this.handle(lib.RoleUpdateRequest, this.handleRoleUpdateRequest.bind(this));
		this.handle(lib.RoleGrantDefaultPermissionsRequest, this.handleRoleGrantDefaultPermissionsRequest.bind(this));
		this.handle(lib.RoleDeleteRequest, this.handleRoleDeleteRequest.bind(this));
		this.handle(lib.UserGetRequest, this.handleUserGetRequest.bind(this));
		this.handle(lib.UserListRequest, this.handleUserListRequest.bind(this));
		this.handle(lib.UserCreateRequest, this.handleUserCreateRequest.bind(this));
		this.handle(lib.UserRevokeTokenRequest, this.handleUserRevokeTokenRequest.bind(this));
		this.handle(lib.UserUpdateRolesRequest, this.handleUserUpdateRolesRequest.bind(this));
		this.handle(lib.UserSetAdminRequest, this.handleUserSetAdminRequest.bind(this));
		this.handle(lib.UserSetBannedRequest, this.handleUserSetBannedRequest.bind(this));
		this.handle(lib.UserSetWhitelistedRequest, this.handleUserSetWhitelistedRequest.bind(this));
		this.handle(lib.UserDeleteRequest, this.handleUserDeleteRequest.bind(this));
		this.handle(lib.DebugDumpWsRequest, this.handleDebugDumpWsRequest.bind(this));
	}

	validateIngress(message: lib.MessageRequest | lib.MessageEvent) {
		let origin = this.connector.dst;
		if (origin.type !== message.src.type || origin.id !== message.src.id) {
			throw new lib.InvalidMessage(`Received message with invalid src ${message.src} from ${origin}`);
		}
	}

	validatePermission(
		message: lib.MessageRequest | lib.MessageEvent,
		entry: lib.RequestEntry | lib.EventEntry
	) {
		try {
			this.checkPermission(message, entry);
		} catch (err: any) {
			this.connector.sendResponseError(new lib.ResponseError(err.message, err.code), message.src);
			logger.audit(`Permission denied for ${message.name} by ${this.user.name} from ${this.connector.dst}`);
			throw err;
		}
	}

	checkPermission(
		message: lib.MessageRequest | lib.MessageEvent,
		entry: lib.RequestEntry | lib.EventEntry
	) {
		let permission;
		if (message.type === "request") {
			permission = (entry as lib.RequestEntry).Request.permission;
		} else if (message.type === "event") {
			permission = (entry as lib.EventEntry).Event.permission;
		} else {
			return;
		}

		if (permission === null) {
			return;
		}

		if (typeof permission === "string") {
			this.user.checkPermission(permission);
			return;
		}

		if (typeof permission === "function") {
			permission(this.user, message);
			return;
		}

		throw new Error("Should be unreachable");
	}

	async handleControllerConfigGetRequest(): Promise<lib.RawConfig> {
		return new lib.RawConfig(this._controller.config.serialize("control"));
	}

	async handleControllerConfigSetFieldRequest(request: lib.ControllerConfigSetFieldRequest) {
		this._controller.config.set(request.field, request.value, "control");
	}

	async handleControllerConfigSetPropRequest(request: lib.ControllerConfigSetPropRequest) {
		let { field, prop, value } = request;
		this._controller.config.setProp(field, prop, value, "control");
	}

	async handleHostListRequest(): Promise<lib.HostDetails[]> {
		let list = [];
		for (let host of this._controller.hosts!.values()) {
			list.push(new lib.HostDetails(
				host.agent,
				host.version,
				host.name,
				host.id,
				this._controller.wsServer.hostConnections.has(host.id),
				host.public_address,
			));
		}
		return list;
	}

	async handleHostGenerateTokenRequest(message: lib.HostGenerateTokenRequest) {
		let hostId = message.hostId;
		if (hostId === undefined) {
			hostId = Math.random() * 2**31 | 0;
		}
		return this._controller.generateHostToken(hostId);
	}

	async handleHostConfigCreateRequest(request: lib.HostConfigCreateRequest) {
		let hostConfig = new lib.HostConfig("control");
		await hostConfig.init();

		hostConfig.set("host.controller_url", this._controller.getControllerUrl());
		if (request.id !== null) {
			hostConfig.set("host.id", request.id);
		}
		if (request.name !== null) {
			hostConfig.set("host.name", request.name);
		}
		if (request.generateToken) {
			this.user.checkPermission("core.host.generate_token");
			hostConfig.set("host.controller_token", this._controller.generateHostToken(hostConfig.get("host.id")));
		}
		return new lib.RawConfig(hostConfig.serialize());
	}

	async handleInstanceDetailsGetRequest(request: lib.InstanceDetailsGetRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);

		let assigned_host: number|null|undefined = instance.config.get("instance.assigned_host");
		if (assigned_host === null) {
			assigned_host = undefined;
		}

		let game_port: number|null|undefined = instance.game_port
		if (game_port === null) {
			game_port = undefined;
		}

		return new lib.InstanceDetails(
			instance.config.get("instance.name"),
			instance.id,
			assigned_host,
			game_port,
			instance.status,
		);
	}

	async handleInstanceDetailsListRequest() {
		let list = [];
		for (let instance of this._controller.instances!.values()) {
			let assigned_host: number|null|undefined = instance.config.get("instance.assigned_host");
			if (assigned_host === null) {
				assigned_host = undefined;
			}
	
			let game_port: number|null|undefined = instance.game_port
			if (game_port === null) {
				game_port = undefined;
			}

			list.push(new lib.InstanceDetails(
				instance.config.get("instance.name"),
				instance.id,
				assigned_host,
				game_port,
				instance.status,
			));
		}
		return list;
	}

	// XXX should probably add a hook for host reuqests?
	async handleInstanceCreateRequest(request: lib.InstanceCreateRequest) {
		let instanceConfig = new lib.InstanceConfig("controller");
		await instanceConfig.load(request.config as lib.SerializedConfig);
		await this._controller.instanceCreate(instanceConfig);
	}

	async handleInstanceDeleteRequest(request: lib.InstanceDeleteRequest) {
		await this._controller.instanceDelete(request.instanceId);
	}

	async handleInstanceConfigGetRequest(request: lib.InstanceConfigGetRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		return new lib.InstanceConfigGetRequest.Response(instance.config.serialize("control"));
	}

	async handleInstanceConfigSetFieldRequest(request: lib.InstanceConfigSetFieldRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		if (request.field === "instance.assigned_host") {
			throw new lib.RequestError("instance.assigned_host must be set through the assign-host interface");
		}

		if (request.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new lib.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(request.field, request.value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceConfigSetPropRequest(request: lib.InstanceConfigSetPropRequest) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		let { field, prop, value } = request;
		instance.config.setProp(field, prop, value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceAssignRequest(request: lib.InstanceAssignRequest) {
		await this._controller.instanceAssign(request.instanceId, request.hostId);
	}

	async handleInstanceDownloadSaveRequest(request: lib.InstanceDownloadSaveRequest) {
		let { instanceId, name } = request;
		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = name;

		let ready = new Promise((resolve, reject) => {
			stream.events.on("source", resolve);
			stream.events.on("timeout", () => reject(
				new lib.RequestError("Timed out establishing stream from host")
			));
		});
		ready.catch(() => {});

		await this._controller.sendToHostByInstanceId(new lib.InstancePushSaveRequest(
			instanceId,
			stream.id,
			name,
		));

		await ready;
		return stream.id;
	}

	async handleInstanceTransferSaveRequest(request: lib.InstanceTransferSaveRequest) {
		if (request.sourceInstanceId === request.targetInstanceId) {
			throw new lib.RequestError("Source and target instance may not be the same");
		}
		let sourceInstance = this._controller.getRequestInstance(request.sourceInstanceId);
		let targetInstance = this._controller.getRequestInstance(request.targetInstanceId);
		let sourceHostId = sourceInstance.config.get("instance.assigned_host");
		let targetHostId = targetInstance.config.get("instance.assigned_host");
		if (sourceHostId === null) {
			throw new lib.RequestError("Source instance is not assigned a host");
		}
		if (targetHostId === null) {
			throw new lib.RequestError("Target instance is not assigned a host");
		}

		// Let host handle request if source and target is on the same host.
		if (sourceHostId === targetHostId) {
			return await this._controller.sendTo({ hostId: sourceHostId }, request);
		}

		// Check connectivity
		let sourceHostConnection = this._controller.wsServer.hostConnections.get(sourceHostId);
		if (!sourceHostConnection || sourceHostConnection.connector.closing) {
			throw new lib.RequestError("Source host is not connected to the controller");
		}

		let targetHostConnection = this._controller.wsServer.hostConnections.get(targetHostId);
		if (!targetHostConnection || targetHostConnection.connector.closing) {
			throw new lib.RequestError("Target host is not connected to the controller");
		}

		// Create stream to proxy from target to source
		let stream = await routes.createProxyStream(this._controller.app);
		stream.events.on("timeout", () => {
			if (stream.source) {
				stream.source.destroy();
			}
			stream.events.emit("error", new lib.RequestError("Timed out establishing transfer stream"));
		});

		// Ignore errors if not listening for them to avoid crash.
		stream.events.on("error", () => { /* ignore */ });

		// Establish push from source host to stream, this is done first to
		// ensure the file size is known prior to the target host pull.
		await Promise.all([
			this._controller.sendTo(
				{ hostId: sourceHostId },
				new lib.InstancePushSaveRequest(request.sourceInstanceId, stream.id, request.sourceName),
			),
			events.once(stream.events, "source"),
		]);

		// Establish pull from target host to stream and wait for completion.
		let storedName = await this._controller.sendTo(
			{ hostId: targetHostId },
			new lib.InstancePullSaveRequest(request.targetInstanceId, stream.id, request.targetName),
		);

		// Delete source save if this is not a copy
		if (!request.copy) {
			await this._controller.sendTo(
				{ hostId: sourceHostId },
				new lib.InstanceDeleteSaveRequest(request.sourceInstanceId, request.sourceName),
			);
		}

		return storedName;
	}

	async handleModPackListRequest() {
		return [...this._controller.modPacks!.values()];
	}

	async handleModPackCreateRequest(request: lib.ModPackCreateRequest) {
		let modPack = request.modPack;
		if (modPack.id === undefined) {
			throw new lib.RequestError(`Mod pack need an ID to be created`);
		}
		if (this._controller.modPacks!.has(modPack.id)) {
			throw new lib.RequestError(`Mod pack with ID ${modPack.id} already exist`);
		}
		this._controller.modPacks!.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async handleModPackUpdateRequest(request: lib.ModPackUpdateRequest) {
		let modPack = request.modPack;
		if (modPack.id === undefined || !this._controller.modPacks!.has(modPack.id)) {
			throw new lib.RequestError(`Mod pack with ID ${modPack.id} does not exist`);
		}
		this._controller.modPacks!.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async handleModPackDeleteRequest(request: lib.ModPackDeleteRequest) {
		let { id } = request;
		let modPack = this._controller.modPacks!.get(id);
		if (!modPack) {
			throw new lib.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		modPack.isDeleted = true;
		this._controller.modPacks!.delete(id);
		this._controller.modPackUpdated(modPack);
	}

	async handleModGetRequest(request: lib.ModGetRequest) {
		let { name, version } = request;
		let filename = `${name}_${version}.zip`;
		let mod = this._controller.mods!.get(filename);
		if (!mod) {
			throw new lib.RequestError(`Mod ${filename} does not exist`);
		}
		return mod;
	}

	async handleModListRequest() {
		return [...this._controller.mods!.values()];
	}

	static termsMatchesMod(terms: lib.ParsedTerm[], mod: lib.ModInfo) {
		for (let term of terms) {
			if (term.type === "word") {
				if (!lib.wordMatches(term,
					mod.name, mod.version, mod.title, mod.author, mod.contact,
					mod.homepage, mod.description, mod.filename
				)) {
					return false;
				}
			} else if (term.type === "attribute") {
				if (!lib.wordMatches(term.value, mod[term.name as keyof lib.ModInfo] as string)) {
					return false;
				}
			}
		}
		return true;
	}

	async handleModSearchRequest(request: lib.ModSearchRequest) {
		let query = lib.parseSearchString(request.query, {
			name: "word",
			// version
			title: "word",
			author: "word",
			contact: "word",
			homepage: "word",
			description: "word",
			// factorioVersion
			// dependencies
			filename: "word",
			// size
			sha1: "word",
		});
		let factorioVersion = request.factorioVersion;

		type ModVersions = { name: string, versions: lib.ModInfo[] };
		let results: Map<string, ModVersions> = new Map();
		for (let mod of this._controller.mods!.values()) {
			if (
				mod.factorioVersion !== factorioVersion
				|| !ControlConnection.termsMatchesMod(query.terms, mod)
			) {
				continue;
			}
			let result = results.get(mod.name);
			if (!result) {
				result = {
					name: mod.name,
					versions: [],
				};
				results.set(mod.name, result);
			}
			result.versions.push(mod);
		}
		for (let result of results.values()) {
			result.versions.sort((a, b) => b.integerVersion - a.integerVersion);
			result.versions.map(e => e.toJSON());
		}
		let resultList = [...results.values()];

		const sort = request.sort;
		if (sort) {
			const sorters = {
				name: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].name, b.versions[0].name),
				title: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].title, b.versions[0].title),
				author: (a:ModVersions, b:ModVersions) => strcmp(a.versions[0].author, b.versions[0].author),
			};
			if (!Object.prototype.hasOwnProperty.call(sorters, sort)) {
				throw new lib.RequestError(`Invalid value for sort: ${sort}`);
			}
			resultList.sort(sorters[sort as keyof typeof sorters]);
			let order = request.sortOrder;
			if (order === "desc") {
				resultList.reverse();
			}
		}

		const page = request.page;
		const pageSize = request.pageSize || 10;
		resultList = resultList.slice((page - 1) * pageSize, page * pageSize);

		return {
			queryIssues: query.issues,
			pageCount: Math.ceil(results.size / pageSize),
			resultCount: results.size,
			results: resultList,
		};
	}

	async handleModDownloadRequest(request: lib.ModDownloadRequest) {
		let { name, version } = request;
		let filename = `${name}_${version}.zip`;
		let mod = this._controller.mods!.get(filename);
		if (!mod) {
			throw new lib.RequestError(`Mod ${filename} does not exist`);
		}
		let modPath = path.join(this._controller.config.get("controller.mods_directory"), mod.filename);

		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = mod.filename;
		stream.source = fs.createReadStream(modPath);
		stream.mime = "application/zip";
		stream.size = mod.size;

		return stream.id;
	}

	async handleModDeleteRequest(request: lib.ModDeleteRequest) {
		await this._controller.deleteMod(request.name, request.version);
	}

	async handleLogSetSubscriptionsRequest(request: lib.LogSetSubscriptionsRequest) {
		this.logSubscriptions = { 
			all: request.all || false,
			controller: request.controller || false,
			hostIds: request.hostIds || [],
			instanceIds: request.instanceIds || [],
		};
		this.updateLogSubscriptions();
	}

	updateLogSubscriptions() {
		let { all, controller, hostIds, instanceIds } = this.logSubscriptions;
		if (all || controller || hostIds.length || instanceIds.length) {
			if (!this.logTransport) {
				this.logTransport = new lib.LinkTransport({ link: this });
				this._controller.clusterLogger.add(this.logTransport);
			}
			this.logTransport.filter = logFilter(this.logSubscriptions);

		} else if (this.logTransport) {
			this._controller.clusterLogger.remove(this.logTransport);
			this.logTransport = null;
		}
	}

	async handleLogQueryRequest(request: lib.LogQueryRequest) {
		let _request = {
			limit: request.limit,
			order: request.order,
			maxLevel: request.maxLevel,
			all: request.all,
			controller: request.controller,
			hostIds: request.hostIds,
			instanceIds: request.instanceIds,
		}

		let observeDuration = queryLogTime.startTimer();
		let { all, controller, hostIds, instanceIds } = request;

		let log;
		if (!all && controller && !hostIds.length && !instanceIds.length) {
			log = await this._controller.queryControllerLog(_request);
		} else {
			log = await this._controller.queryClusterLog(_request);
		}

		observeDuration();
		return { log };
	}

	async handlePermissionListRequest() {
		let list = [];
		for (let permission of lib.permissions.values()) {
			list.push(new lib.RawPermission(
				permission.name,
				permission.title,
				permission.description,
			));
		}
		return list;
	}

	async handleRoleListRequest() {
		let list = [];
		for (let role of this._controller.userManager.roles.values()) {
			list.push(new lib.RawRole(
				role.id,
				role.name,
				role.description,
				[...role.permissions],
			));
		}
		return list;
	}

	async handleRoleCreateRequest(request: lib.RoleCreateRequest) {
		let lastId = Math.max.apply(null, [...this._controller.userManager.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		this._controller.userManager.roles.set(id, new lib.Role({ id, ...request }));
		return id;
	}

	async handleRoleUpdateRequest(request: lib.RoleUpdateRequest) {
		let { id, name, description, permissions } = request;
		let role = this._controller.userManager.roles.get(id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
		this._controller.rolePermissionsUpdated(role);
	}

	async handleRoleGrantDefaultPermissionsRequest(request: lib.RoleGrantDefaultPermissionsRequest) {
		let role = this._controller.userManager.roles.get(request.id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${request.id} does not exist`);
		}

		role.grantDefaultPermissions();
		this._controller.rolePermissionsUpdated(role);
	}

	async handleRoleDeleteRequest(request: lib.RoleDeleteRequest) {
		let id = request.id;
		let role = this._controller.userManager.roles.get(id);
		if (!role) {
			throw new lib.RequestError(`Role with ID ${id} does not exist`);
		}

		this._controller.userManager.roles.delete(id);
		for (let user of this._controller.userManager.users.values()) {
			user.roles.delete(role);
			this._controller.userPermissionsUpdated(user);
		}
	}

	async handleUserGetRequest(request: lib.UserGetRequest) {
		let name = request.name;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			throw new lib.RequestError(`User ${name} does not exist`);
		}

		return new lib.RawUser(
			user.name,
			[...user.roles].map(role => role.id),
			[...user.instances],
			user.isAdmin,
			user.isBanned,
			user.isWhitelisted,
			user.banReason,
			undefined,
			user.playerStats,
			user.instanceStats,
		);
	}

	async handleUserListRequest() {
		let list = [];
		for (let user of this._controller.userManager.users.values()) {
			list.push(new lib.RawUser(
				user.name,
				[...user.roles].map(role => role.id),
				[...user.instances],
				user.isAdmin,
				user.isBanned,
				user.isWhitelisted,
				undefined,
				undefined,
				user.playerStats,
				undefined,
			));
		}
		return list;
	}

	async handleUserCreateRequest(request: lib.UserCreateRequest) {
		let user = this._controller.userManager.createUser(request.name);
		this._controller.userUpdated(user);
	}

	async handleUserRevokeTokenRequest(request: lib.UserRevokeTokenRequest) {
		let user = this._controller.userManager.users.get(request.name);
		if (!user) {
			throw new lib.RequestError(`User '${request.name}' does not exist`);
		}
		if (user.name !== this.user.name) {
			this.user.checkPermission("core.user.revoke_other_token");
		}

		user.invalidateToken();
		for (let controlConnection of this._controller.wsServer.controlConnections.values()) {
			if (controlConnection.user.name === user.name) {
				controlConnection.connector.terminate();
			}
		}
		this._controller.userUpdated(user);
	}

	async handleUserUpdateRolesRequest(request: lib.UserUpdateRolesRequest) {
		let user = this._controller.userManager.users.get(request.name);
		if (!user) {
			throw new lib.RequestError(`User '${request.name}' does not exist`);
		}

		let resolvedRoles: Set<lib.Role> = new Set();
		for (let roleId of request.roles) {
			let role = this._controller.userManager.roles.get(roleId);
			if (!role) {
				throw new lib.RequestError(`Role with ID ${roleId} does not exist`);
			}

			resolvedRoles.add(role);
		}

		user.roles = resolvedRoles;
		this._controller.userPermissionsUpdated(user);
		this._controller.userUpdated(user);
	}

	async handleUserSetAdminRequest(request: lib.UserSetAdminRequest) {
		let { name, create, admin } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isAdmin = admin;
		this._controller.userUpdated(user);
		this._controller.sendTo("allInstances", new lib.InstanceAdminlistUpdateEvent(name, admin));
	}

	async handleUserSetBannedRequest(request: lib.UserSetBannedRequest) {
		let { name, create, banned, reason } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isBanned = banned;
		user.banReason = reason;
		this._controller.userUpdated(user);
		this._controller.sendTo("allInstances", new lib.InstanceBanlistUpdateEvent(name, banned, reason));
	}

	async handleUserSetWhitelistedRequest(request: lib.UserSetWhitelistedRequest) {
		let { name, create, whitelisted } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new lib.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isWhitelisted = whitelisted;
		this._controller.userUpdated(user);
		this._controller.sendTo("allInstances", new lib.InstanceWhitelistUpdateEvent(name, whitelisted));
	}

	async handleUserDeleteRequest(request: lib.UserDeleteRequest) {
		let name = request.name;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			throw new lib.RequestError(`User '${name}' does not exist`);
		}

		user.isDeleted = true;
		this._controller.userManager.users.delete(name);
		this._controller.userUpdated(user);

		if (user.isAdmin) {
			this._controller.sendTo("allInstances", new lib.InstanceAdminlistUpdateEvent(name, false));
		}
		if (user.isWhitelisted) {
			this._controller.sendTo("allInstances", new lib.InstanceWhitelistUpdateEvent(name, false));
		}
		if (user.isBanned) {
			this._controller.sendTo("allInstances", new lib.InstanceBanlistUpdateEvent(name, false, ""));
		}
	}

	async handleDebugDumpWsRequest(request: lib.DebugDumpWsRequest) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				this.send(new lib.DebugWsMessageEvent(data.direction, data.content));
			}
		};
		this.connector._socket!.clusterio_ignore_dump = true;
		this._controller.debugEvents.on("message", this.ws_dumper);
	}
}

module.exports = ControlConnection;
