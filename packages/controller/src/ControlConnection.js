"use strict";
const events = require("events");
const fs = require("fs-extra");
const path = require("path");

const libConfig = require("@clusterio/lib/config");
const libData = require("@clusterio/lib/data");
const libErrors = require("@clusterio/lib/errors");
const libHelpers = require("@clusterio/lib/helpers");
const libLink = require("@clusterio/lib/link");
const { logFilter, logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libPrometheus = require("@clusterio/lib/prometheus");
const libUsers = require("@clusterio/lib/users");

const BaseConnection = require("./BaseConnection");
const routes = require("./routes");

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

const queryLogTime = new libPrometheus.Summary(
	"clusterio_controller_query_log_duration_seconds",
	"Time in seconds log queries took to execute."
);

/**
 * Represents the connection to a control link
 *
 * @extends module:controller/src/BaseConnection
 * @alias module:controller/src/ControlConnection
 */
class ControlConnection extends BaseConnection {
	constructor(registerData, connector, controller, user, id) {
		super(connector, controller);

		this._agent = registerData.agent;
		this._version = registerData.version;
		this.id = id;
		this.dst = new libData.Address(libData.Address.instance, id);

		/**
		 * The user making this connection.
		 * @type {module:lib/users.User}
		 */
		this.user = user;

		this.hostSubscriptions = {
			all: false,
			hostIds: [],
		};

		this.instanceSubscriptions = {
			all: false,
			instanceIds: [],
		};

		this.saveListSubscriptions = {
			all: false,
			instanceIds: [],
		};

		this.modPackSubscriptions = {
			all: false,
			modPackIds: [],
		};

		this.modSubscriptions = {
			all: false,
			modNames: [],
		};

		this.userSubscriptions = {
			all: false,
			names: [],
		};

		this.logTransport = null;
		this.logSubscriptions = {
			all: false,
			controller: false,
			hostIds: [],
			instanceIds: [],
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
				this._controller.debugEvents.off("message", this.ws_dumper);
			}
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let controllerPlugin of this._controller.plugins.values()) {
					controllerPlugin.onControlConnectionEvent(this, event);
				}
			});
		}

		this.handle(libData.ControllerConfigGetRequest, this.handleControllerConfigGetRequest.bind(this));
		this.handle(libData.ControllerConfigSetFieldRequest, this.handleControllerConfigSetFieldRequest.bind(this));
		this.handle(libData.ControllerConfigSetPropRequest, this.handleControllerConfigSetPropRequest.bind(this));
		this.handle(libData.HostListRequest, this.handleHostListRequest.bind(this));
		this.handle(libData.HostSetSubscriptionsRequest, this.handleHostSetSubscriptionsRequest.bind(this));
		this.handle(libData.HostGenerateTokenRequest, this.handleHostGenerateTokenRequest.bind(this));
		this.handle(libData.HostConfigCreateRequest, this.handleHostConfigCreateRequest.bind(this));
		this.handle(libData.InstanceDetailsGetRequest, this.handleInstanceDetailsGetRequest.bind(this));
		this.handle(libData.InstanceDetailsListRequest, this.handleInstanceDetailsListRequest.bind(this));
		this.handle(
			libData.InstanceDetailsSetSubscriptionsRequest, this.handleInstanceDetailsSetSubscriptionsRequest.bind(this)
		);
		this.handle(libData.InstanceCreateRequest, this.handleInstanceCreateRequest.bind(this));
		this.handle(libData.InstanceDeleteRequest, this.handleInstanceDeleteRequest.bind(this));
		this.handle(libData.InstanceConfigGetRequest, this.handleInstanceConfigGetRequest.bind(this));
		this.handle(libData.InstanceConfigSetFieldRequest, this.handleInstanceConfigSetFieldRequest.bind(this));
		this.handle(libData.InstanceConfigSetPropRequest, this.handleInstanceConfigSetPropRequest.bind(this));
		this.handle(libData.InstanceAssignRequest, this.handleInstanceAssignRequest.bind(this));
		this.handle(
			libData.InstanceSetSaveListSubscriptionsRequest,
			this.handleInstanceSetSaveListSubscriptionsRequest.bind(this)
		);
		this.handle(
			libData.InstanceRenameSaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller)
		);
		this.handle(libData.InstanceCopySaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller));
		this.handle(
			libData.InstanceDeleteSaveRequest, this._controller.sendToHostByInstanceId.bind(this._controller)
		);
		this.handle(libData.InstanceDownloadSaveRequest, this.handleInstanceDownloadSaveRequest.bind(this));
		this.handle(libData.InstanceTransferSaveRequest, this.handleInstanceTransferSaveRequest.bind(this));
		this.handle(libData.ModPackListRequest, this.handleModPackListRequest.bind(this));
		this.handle(libData.ModPackSetSubscriptionsRequest, this.handleModPackSetSubscriptionsRequest.bind(this));
		this.handle(libData.ModPackCreateRequest, this.handleModPackCreateRequest.bind(this));
		this.handle(libData.ModPackUpdateRequest, this.handleModPackUpdateRequest.bind(this));
		this.handle(libData.ModPackDeleteRequest, this.handleModPackDeleteRequest.bind(this));
		this.handle(libData.ModGetRequest, this.handleModGetRequest.bind(this));
		this.handle(libData.ModListRequest, this.handleModListRequest.bind(this));
		this.handle(libData.ModSearchRequest, this.handleModSearchRequest.bind(this));
		this.handle(libData.ModSetSubscriptionsRequest, this.handleModSetSubscriptionsRequest.bind(this));
		this.handle(libData.ModDownloadRequest, this.handleModDownloadRequest.bind(this));
		this.handle(libData.ModDeleteRequest, this.handleModDeleteRequest.bind(this));
		this.handle(libData.LogSetSubscriptionsRequest, this.handleLogSetSubscriptionsRequest.bind(this));
		this.handle(libData.LogQueryRequest, this.handleLogQueryRequest.bind(this));
		this.handle(libData.PermissionListRequest, this.handlePermissionListRequest.bind(this));
		this.handle(libData.RoleListRequest, this.handleRoleListRequest.bind(this));
		this.handle(libData.RoleCreateRequest, this.handleRoleCreateRequest.bind(this));
		this.handle(libData.RoleUpdateRequest, this.handleRoleUpdateRequest.bind(this));
		this.handle(
			libData.RoleGrantDefaultPermissionsRequest, this.handleRoleGrantDefaultPermissionsRequest.bind(this)
		);
		this.handle(libData.RoleDeleteRequest, this.handleRoleDeleteRequest.bind(this));
		this.handle(libData.UserGetRequest, this.handleUserGetRequest.bind(this));
		this.handle(libData.UserListRequest, this.handleUserListRequest.bind(this));
		this.handle(libData.UserSetSubscriptionsRequest, this.handleUserSetSubscriptionsRequest.bind(this));
		this.handle(libData.UserCreateRequest, this.handleUserCreateRequest.bind(this));
		this.handle(libData.UserRevokeTokenRequest, this.handleUserRevokeTokenRequest.bind(this));
		this.handle(libData.UserUpdateRolesRequest, this.handleUserUpdateRolesRequest.bind(this));
		this.handle(libData.UserSetAdminRequest, this.handleUserSetAdminRequest.bind(this));
		this.handle(libData.UserSetBannedRequest, this.handleUserSetBannedRequest.bind(this));
		this.handle(libData.UserSetWhitelistedRequest, this.handleUserSetWhitelistedRequest.bind(this));
		this.handle(libData.UserDeleteRequest, this.handleUserDeleteRequest.bind(this));
		this.handle(libData.DebugDumpWsRequest, this.handleDebugDumpWsRequest.bind(this));
	}

	async handleControllerConfigGetRequest() {
		return new libData.RawConfig(this._controller.config.serialize("control"));
	}

	async handleControllerConfigSetFieldRequest(request) {
		this._controller.config.set(request.field, request.value, "control");
	}

	async handleControllerConfigSetPropRequest(request) {
		let { field, prop, value } = request;
		this._controller.config.setProp(field, prop, value, "control");
	}

	async handleHostListRequest() {
		let list = [];
		for (let host of this._controller.hosts.values()) {
			list.push(new libData.HostDetails(
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

	async handleHostSetSubscriptionsRequest(request) {
		this.hostSubscriptions = { ...request };
	}

	hostUpdated(host, update) {
		if (
			this.hostSubscriptions.all
			|| this.hostSubscriptions.hostIds.includes(host.id)
		) {
			this.send(new libData.HostUpdateEvent(update));
		}
	}

	async handleHostGenerateTokenRequest(message) {
		let hostId = message.host_id;
		if (hostId === null) {
			hostId = Math.random() * 2**31 | 0;
		}
		return this._controller.generateHostToken(hostId);
	}

	async handleHostConfigCreateRequest(request) {
		let hostConfig = new libConfig.HostConfig("control");
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
		return new libData.RawConfig(hostConfig.serialize());
	}

	async handleInstanceDetailsGetRequest(request) {
		let instance = this._controller.getRequestInstance(request.instanceId);

		return new libData.InstanceDetails(
			instance.config.get("instance.name"),
			instance.id,
			instance.config.get("instance.assigned_host"),
			instance.game_port || null,
			instance.status,
		);
	}

	async handleInstanceDetailsListRequest() {
		let list = [];
		for (let instance of this._controller.instances.values()) {
			list.push(new libData.InstanceDetails(
				instance.config.get("instance.name"),
				instance.id,
				instance.config.get("instance.assigned_host"),
				instance.game_port || null,
				instance.status,
			));
		}
		return list;
	}

	async handleInstanceDetailsSetSubscriptionsRequest(request) {
		this.instanceSubscriptions = { ...request };
	}

	instanceUpdated(instance) {
		if (
			this.instanceSubscriptions.all
			|| this.instanceSubscriptions.instanceIds.includes(instance.id)
		) {
			this.send(new libData.InstanceDetailsUpdateEvent(
				new libData.InstanceDetails(
					instance.config.get("instance.name"),
					instance.id,
					instance.config.get("instance.assigned_host"),
					instance.game_port || null,
					instance.status,
				)
			));
		}
	}

	// XXX should probably add a hook for host reuqests?
	async handleInstanceCreateRequest(request) {
		let instanceConfig = new libConfig.InstanceConfig("controller");
		await instanceConfig.load(request.config);
		await this._controller.instanceCreate(instanceConfig);
	}

	async handleInstanceDeleteRequest(request) {
		await this._controller.instanceDelete(request.instanceId);
	}

	async handleInstanceConfigGetRequest(request) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		return new libData.InstanceConfigGetRequest.Response(instance.config.serialize("control"));
	}

	async handleInstanceConfigSetFieldRequest(request) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		if (request.field === "instance.assigned_host") {
			throw new libErrors.RequestError("instance.assigned_host must be set through the assign-host interface");
		}

		if (request.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new libErrors.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(request.field, request.value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceConfigSetPropRequest(request) {
		let instance = this._controller.getRequestInstance(request.instanceId);
		let { field, prop, value } = request;
		instance.config.setProp(field, prop, value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async handleInstanceAssignRequest(request) {
		await this._controller.instanceAssign(request.instanceId, request.hostId);
	}

	async handleInstanceSetSaveListSubscriptionsRequest(request) {
		this.saveListSubscriptions = { ...request };
	}

	saveListUpdate(instanceId, saves) {
		if (
			this.saveListSubscriptions.all
			|| this.saveListSubscriptions.instanceIds.includes(instanceId)
		) {
			this.send(new libData.InstanceSaveListUpdateEvent(instanceId, saves));
		}
	}

	async handleInstanceDownloadSaveRequest(request) {
		let { instanceId, name } = request;
		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = name;

		let ready = new Promise((resolve, reject) => {
			stream.events.on("source", resolve);
			stream.events.on("timeout", () => reject(
				new libErrors.RequestError("Timed out establishing stream from host")
			));
		});
		ready.catch(() => {});

		await this._controller.sendToHostByInstanceId(new libData.InstancePushSaveRequest(
			instanceId,
			stream.id,
			name,
		));

		await ready;
		return stream.id;
	}

	async handleInstanceTransferSaveRequest(request) {
		// XXX if control sends the request directly to a host these checks are bypassed
		if (request.copy) {
			this.user.checkPermission("core.instance.save.copy");
		} else if (request.sourceName !== request.targetName) {
			this.user.checkPermission("core.instance.save.rename");
		}

		if (request.sourceInstanceId === request.targetInstanceId) {
			throw new libErrors.RequestError("Source and target instance may not be the same");
		}
		let sourceInstance = this._controller.getRequestInstance(request.sourceInstanceId);
		let targetInstance = this._controller.getRequestInstance(request.targetInstanceId);
		let sourceHostId = sourceInstance.config.get("instance.assigned_host");
		let targetHostId = targetInstance.config.get("instance.assigned_host");
		if (sourceHostId === null) {
			throw new libErrors.RequestError("Source instance is not assigned a host");
		}
		if (targetHostId === null) {
			throw new libErrors.RequestError("Target instance is not assigned a host");
		}

		// Let host handle request if source and target is on the same host.
		if (sourceHostId === targetHostId) {
			return await this._controller.sendTo(request, { hostId: sourceHostId });
		}

		// Check connectivity
		let sourceHostConnection = this._controller.wsServer.hostConnections.get(sourceHostId);
		if (!sourceHostConnection || sourceHostConnection.closing) {
			throw new libErrors.RequestError("Source host is not connected to the controller");
		}

		let targetHostConnection = this._controller.wsServer.hostConnections.get(targetHostId);
		if (!targetHostConnection || targetHostConnection.closing) {
			throw new libErrors.RequestError("Target host is not connected to the controller");
		}

		// Create stream to proxy from target to source
		let stream = await routes.createProxyStream(this._controller.app);
		stream.events.on("timeout", () => {
			if (stream.source) {
				stream.source.destroy();
			}
			stream.events.emit("error", new libErrors.RequestError("Timed out establishing transfer stream"));
		});

		// Ignore errors if not listening for them to avoid crash.
		stream.events.on("error", () => { /* ignore */ });

		// Establish push from source host to stream, this is done first to
		// ensure the file size is known prior to the target host pull.
		await Promise.all([
			this._controller.sendTo(
				new libData.InstancePushSaveRequest(request.sourceInstanceId, stream.id, request.sourceName),
				{ hostId: sourceHostId }
			),
			events.once(stream.events, "source"),
		]);

		// Establish pull from target host to stream and wait for completion.
		let storedName = await this._controller.sendTo(
			new libData.InstancePullSaveRequest(request.targetInstanceId, stream.id, request.targetName),
			{ hostId: targetHostId },
		);

		// Delete source save if this is not a copy
		if (!request.copy) {
			await this._controller.sendTo(
				new libData.InstanceDeleteSaveRequest(request.sourceInstanceId, request.sourceName),
				{ hostId: sourceHostId }
			);
		}

		return storedName;
	}

	async handleModPackListRequest() {
		return [...this._controller.modPacks.values()];
	}

	async handleModPackSetSubscriptionsRequest(request) {
		this.modPackSubscriptions = { ...request };
	}

	async handleModPackCreateRequest(request) {
		let modPack = request.modPack;
		if (this._controller.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} already exist`);
		}
		this._controller.modPacks.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async handleModPackUpdateRequest(request) {
		let modPack = request.modPack;
		if (!this._controller.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} does not exist`);
		}
		this._controller.modPacks.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async handleModPackDeleteRequest(request) {
		let { id } = request;
		let modPack = this._controller.modPacks.get(id);
		if (!modPack) {
			throw new libErrors.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		modPack.isDeleted = true;
		this._controller.modPacks.delete(id);
		this._controller.modPackUpdated(modPack);
	}

	modPackUpdated(modPack) {
		if (
			this.modPackSubscriptions.all
			|| this.modPackSubscriptions.modPackIds.includes(modPack.id)
		) {
			this.send(new libData.ModPackUpdateEvent(modPack));
		}
	}

	async handleModGetRequest(request) {
		let { name, version } = request;
		let filename = `${name}_${version}.zip`;
		let mod = this._controller.mods.get(filename);
		if (!mod) {
			throw new libErrors.RequestError(`Mod ${filename} does not exist`);
		}
		return mod;
	}

	async handleModListRequest() {
		return [...this._controller.mods.values()];
	}

	static termsMatchesMod(terms, mod) {
		for (let term of terms) {
			if (term.type === "word") {
				if (!libHelpers.wordMatches(term,
					mod.name, mod.version, mod.title, mod.author, mod.contact,
					mod.homepage, mod.description, mod.filename
				)) {
					return false;
				}
			} else if (term.type === "attribute") {
				if (!libHelpers.wordMatches(term.value, mod[term.name])) {
					return false;
				}
			}
		}
		return true;
	}

	async handleModSearchRequest(request) {
		let query = libHelpers.parseSearchString(request.query, {
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

		let results = new Map();
		for (let mod of this._controller.mods.values()) {
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
				name: (a, b) => strcmp(a.versions[0].name, b.versions[0].name),
				title: (a, b) => strcmp(a.versions[0].title, b.versions[0].title),
				author: (a, b) => strcmp(a.versions[0].author, b.versions[0].author),
			};
			if (!Object.prototype.hasOwnProperty.call(sorters, sort)) {
				throw new libErrors.RequestError(`Invalid value for sort: ${sort}`);
			}
			resultList.sort(sorters[sort]);
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

	async handleModSetSubscriptionsRequest(request) {
		this.modSubscriptions = { ...request };
	}

	async handleModDownloadRequest(request) {
		let { name, version } = request;
		let filename = `${name}_${version}.zip`;
		let mod = this._controller.mods.get(filename);
		if (!mod) {
			throw new libErrors.RequestError(`Mod ${filename} does not exist`);
		}
		let modPath = path.join(this._controller.config.get("controller.mods_directory"), mod.filename);

		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = mod.filename;
		stream.source = fs.createReadStream(modPath);
		stream.mime = "application/zip";
		stream.size = mod.size;

		return stream.id;
	}

	async handleModDeleteRequest(request) {
		await this._controller.deleteMod(request.name, request.version);
	}

	async handleLogSetSubscriptionsRequest(request) {
		this.logSubscriptions = { ...request };
		this.updateLogSubscriptions();
	}

	modUpdated(mod) {
		if (
			this.modSubscriptions.all
			|| this.modSubscriptions.modNames.includes(mod.name)
		) {
			this.send(new libData.ModUpdateEvent(mod));
		}
	}

	updateLogSubscriptions() {
		let { all, controller, hostIds, instanceIds } = this.logSubscriptions;
		if (all || controller || hostIds.length || instanceIds.length) {
			if (!this.logTransport) {
				this.logTransport = new libLoggingUtils.LinkTransport({ link: this });
				this._controller.clusterLogger.add(this.logTransport);
			}
			this.logTransport.filter = logFilter(this.logSubscriptions);

		} else if (this.logTransport) {
			this._controller.clusterLogger.remove(this.logTransport);
			this.logTransport = null;
		}
	}

	async handleLogQueryRequest(request) {
		let observeDuration = queryLogTime.startTimer();
		let { all, controller, hostIds, instanceIds } = request;

		let log;
		if (!all && controller && !hostIds.length && !instanceIds.length) {
			log = await this._controller.queryControllerLog(request);
		} else {
			log = await this._controller.queryClusterLog(request);
		}

		observeDuration();
		return { log };
	}

	async handlePermissionListRequest() {
		let list = [];
		for (let permission of libUsers.permissions.values()) {
			list.push(new libData.RawPermission(
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
			list.push(new libData.RawRole(
				role.id,
				role.name,
				role.description,
				[...role.permissions],
			));
		}
		return list;
	}

	async handleRoleCreateRequest(request) {
		let lastId = Math.max.apply(null, [...this._controller.userManager.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		this._controller.userManager.roles.set(id, new libUsers.Role({ id, ...request }));
		return id;
	}

	async handleRoleUpdateRequest(request) {
		let { id, name, description, permissions } = request;
		let role = this._controller.userManager.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
		this._controller.rolePermissionsUpdated(role);
	}

	async handleRoleGrantDefaultPermissionsRequest(request) {
		let role = this._controller.userManager.roles.get(request.id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${request.id} does not exist`);
		}

		role.grantDefaultPermissions();
		this._controller.rolePermissionsUpdated(role);
	}

	async handleRoleDeleteRequest(request) {
		let id = request.id;
		let role = this._controller.userManager.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		this._controller.userManager.roles.delete(id);
		for (let user of this._controller.userManager.users.values()) {
			user.roles.delete(role);
			this._controller.userPermissionsUpdated(user);
		}
	}

	async handleUserGetRequest(request) {
		let name = request.name;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			throw new libErrors.RequestError(`User ${name} does not exist`);
		}

		return new libData.RawUser(
			user.name,
			[...user.roles].map(role => role.id),
			[...user.instances],
			user.isAdmin,
			user.isBanned,
			user.isWhitelisted,
			user.banReason,
			undefined,
			user.playerStats,
			[...user.instanceStats],
		);
	}

	async handleUserListRequest() {
		let list = [];
		for (let user of this._controller.userManager.users.values()) {
			list.push(new libData.RawUser(
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

	async handleUserSetSubscriptionsRequest(request) {
		this.userSubscriptions = { ...request };
	}

	userUpdated(user) {
		if (
			this.userSubscriptions.all
			|| this.userSubscriptions.names.includes(user.name)
		) {
			this.send(new libData.UserUpdateEvent(
				new libData.RawUser(
					user.name,
					[...user.roles].map(role => role.id),
					[...user.instances],
					user.isAdmin,
					user.isBanned,
					user.isWhitelisted,
					user.banReason,
					user.isDeleted,
					user.playerStats,
					[...user.instanceStats],
				)
			));
		}
	}

	async handleUserCreateRequest(request) {
		let user = this._controller.userManager.createUser(request.name);
		this._controller.userUpdated(user);
	}

	async handleUserRevokeTokenRequest(request) {
		let user = this._controller.userManager.users.get(request.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${request.name}' does not exist`);
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

	async handleUserUpdateRolesRequest(request) {
		let user = this._controller.userManager.users.get(request.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${request.name}' does not exist`);
		}

		let resolvedRoles = new Set();
		for (let roleId of request.roles) {
			let role = this._controller.userManager.roles.get(roleId);
			if (!role) {
				throw new libErrors.RequestError(`Role with ID ${roleId} does not exist`);
			}

			resolvedRoles.add(role);
		}

		user.roles = resolvedRoles;
		this._controller.userPermissionsUpdated(user);
		this._controller.userUpdated(user);
	}

	async handleUserSetAdminRequest(request) {
		let { name, create, admin } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isAdmin = admin;
		this._controller.userUpdated(user);
		this._controller.sendTo(new libData.InstanceAdminlistUpdateEvent(name, admin), "allInstances");
	}

	async handleUserSetBannedRequest(request) {
		let { name, create, banned, reason } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isBanned = banned;
		user.banReason = reason;
		this._controller.userUpdated(user);
		this._controller.sendTo(new libData.InstanceBanlistUpdateEvent(name, banned, reason), "allInstances");
	}

	async handleUserSetWhitelistedRequest(request) {
		let { name, create, whitelisted } = request;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._controller.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isWhitelisted = whitelisted;
		this._controller.userUpdated(user);
		this._controller.sendTo(new libData.InstanceWhitelistUpdateEvent(name, whitelisted), "allInstances");
	}

	async handleUserDeleteRequest(request) {
		let name = request.name;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			throw new libErrors.RequestError(`User '${name}' does not exist`);
		}

		user.isDeleted = true;
		this._controller.userManager.users.delete(name);
		this._controller.userUpdated(user);

		if (user.is_admin) {
			this._controller.sendTo(new libData.InstanceAdminlistUpdateEvent(name, false), "allInstances");
		}
		if (user.is_whitelisted) {
			this._controller.sendTo(new libData.InstanceWhitelistUpdateEvent(name, false), "allInstances");
		}
		if (user.is_banned) {
			this._controller.sendTo(new libData.InstanceBanlistUpdateEvent(name, false, ""), "allInstances");
		}
	}

	async handleDebugDumpWsRequest(request) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				this.send(new libData.DebugWsMessageEvent(data.direction, data.content));
			}
		};
		this.connector._socket.clusterio_ignore_dump = true;
		this._controller.debugEvents.on("message", this.ws_dumper);
	}
}

module.exports = ControlConnection;
