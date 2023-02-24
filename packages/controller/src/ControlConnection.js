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
	constructor(registerData, connector, controller, user) {
		super("control", connector, controller);

		this._agent = registerData.agent;
		this._version = registerData.version;

		/**
		 * The user making this connection.
		 * @type {module:lib/users.User}
		 */
		this.user = user;

		this.hostSubscriptions = {
			all: false,
			host_ids: [],
		};

		this.instanceSubscriptions = {
			all: false,
			instance_ids: [],
		};

		this.saveListSubscriptions = {
			all: false,
			instance_ids: [],
		};

		this.modPackSubscriptions = {
			all: false,
			mod_pack_ids: [],
		};

		this.modSubscriptions = {
			all: false,
			mod_names: [],
		};

		this.userSubscriptions = {
			all: false,
			names: [],
		};

		this.logTransport = null;
		this.logSubscriptions = {
			all: false,
			controller: false,
			host_ids: [],
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
	}

	async getControllerConfigRequestHandler() {
		return { serialized_config: this._controller.config.serialize("control") };
	}

	async setControllerConfigFieldRequestHandler(message) {
		this._controller.config.set(message.data.field, message.data.value, "control");
	}

	async setControllerConfigPropRequestHandler(message) {
		let { field, prop, value } = message.data;
		this._controller.config.setProp(field, prop, value, "control");
	}

	async listHostsRequestHandler(message) {
		let list = [];
		for (let host of this._controller.hosts.values()) {
			list.push({
				agent: host.agent,
				version: host.version,
				id: host.id,
				name: host.name,
				public_address: host.public_address || null,
				connected: this._controller.wsServer.hostConnections.has(host.id),
			});
		}
		return { list };
	}

	async setHostSubscriptionsRequestHandler(message) {
		this.hostSubscriptions = message.data;
	}

	hostUpdated(host, update) {
		if (
			this.hostSubscriptions.all
			|| this.hostSubscriptions.host_ids.includes(host.id)
		) {
			libLink.messages.hostUpdate.send(this, update);
		}
	}

	async generateHostTokenRequestHandler(message) {
		let hostId = message.data.host_id;
		if (hostId === null) {
			hostId = Math.random() * 2**31 | 0;
		}
		return { token: this._controller.generateHostToken(hostId) };
	}

	async createHostConfigRequestHandler(message) {
		let hostConfig = new libConfig.HostConfig("control");
		await hostConfig.init();

		hostConfig.set("host.controller_url", this._controller.getControllerUrl());
		if (message.data.id !== null) {
			hostConfig.set("host.id", message.data.id);
		}
		if (message.data.name !== null) {
			hostConfig.set("host.name", message.data.name);
		}
		if (message.data.generate_token) {
			this.user.checkPermission("core.host.generate_token");
			hostConfig.set("host.controller_token", this._controller.generateHostToken(hostConfig.get("host.id")));
		}
		return { serialized_config: hostConfig.serialize() };
	}

	async getInstanceRequestHandler(message) {
		let id = message.data.id;
		let instance = this._controller.getRequestInstance(id);

		return {
			id,
			name: instance.config.get("instance.name"),
			assigned_host: instance.config.get("instance.assigned_host"),
			game_port: instance.game_port || null,
			status: instance.status,
		};
	}

	async listInstancesRequestHandler(message) {
		let list = [];
		for (let instance of this._controller.instances.values()) {
			list.push({
				id: instance.config.get("instance.id"),
				name: instance.config.get("instance.name"),
				assigned_host: instance.config.get("instance.assigned_host"),
				game_port: instance.game_port || null,
				status: instance.status,
			});
		}
		return { list };
	}

	async setInstanceSubscriptionsRequestHandler(message) {
		this.instanceSubscriptions = message.data;
	}

	instanceUpdated(instance) {
		if (
			this.instanceSubscriptions.all
			|| this.instanceSubscriptions.instance_ids.includes(instance.config.get("instance.id"))
		) {
			libLink.messages.instanceUpdate.send(this, {
				id: instance.config.get("instance.id"),
				name: instance.config.get("instance.name"),
				assigned_host: instance.config.get("instance.assigned_host"),
				game_port: instance.game_port || null,
				status: instance.status,
			});
		}
	}

	// XXX should probably add a hook for host reuqests?
	async createInstanceRequestHandler(message) {
		let instanceConfig = new libConfig.InstanceConfig("controller");
		await instanceConfig.load(message.data.serialized_config);
		await this._controller.instanceCreate(instanceConfig);
	}

	async deleteInstanceRequestHandler(message, request) {
		await this._controller.instanceDelete(message.data.instance_id);
	}

	async getInstanceConfigRequestHandler(message) {
		let instance = this._controller.getRequestInstance(message.data.instance_id);
		return {
			serialized_config: instance.config.serialize("control"),
		};
	}

	async setInstanceConfigFieldRequestHandler(message) {
		let instance = this._controller.getRequestInstance(message.data.instance_id);
		if (message.data.field === "instance.assigned_host") {
			throw new libErrors.RequestError("instance.assigned_host must be set through the assign-host interface");
		}

		if (message.data.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new libErrors.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(message.data.field, message.data.value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async setInstanceConfigPropRequestHandler(message) {
		let instance = this._controller.getRequestInstance(message.data.instance_id);
		let { field, prop, value } = message.data;
		instance.config.setProp(field, prop, value, "control");
		await this._controller.instanceConfigUpdated(instance);
	}

	async assignInstanceCommandRequestHandler(message, request) {
		let { host_id, instance_id } = message.data;
		await this._controller.instanceAssign(instance_id, host_id);
	}

	async setSaveListSubscriptionsRequestHandler(message) {
		this.saveListSubscriptions = message.data;
	}

	saveListUpdate(data) {
		if (
			this.saveListSubscriptions.all
			|| this.saveListSubscriptions.instance_ids.includes(data.instance_id)
		) {
			libLink.messages.saveListUpdate.send(this, data);
		}
	}

	async downloadSaveRequestHandler(message) {
		let { instance_id, save } = message.data;
		let stream = await routes.createProxyStream(this._controller.app);
		stream.filename = save;

		let ready = new Promise((resolve, reject) => {
			stream.events.on("source", resolve);
			stream.events.on("timeout", () => reject(
				new libErrors.RequestError("Timed out establishing stream from host")
			));
		});
		ready.catch(() => {});

		await this._controller.forwardRequestToInstance(libLink.messages.pushSave, {
			instance_id,
			stream_id: stream.id,
			save,
		});

		await ready;
		return { stream_id: stream.id };
	}

	async transferSaveRequestHandler(message, request) {
		let { source_save, target_save, copy, instance_id, target_instance_id } = message.data;
		if (copy) {
			this.user.checkPermission("core.instance.save.copy");
		} else if (source_save !== target_save) {
			this.user.checkPermission("core.instance.save.rename");
		}

		if (instance_id === target_instance_id) {
			throw new libErrors.RequestError("Source and target instance may not be the same");
		}
		let sourceInstance = this._controller.getRequestInstance(instance_id);
		let targetInstance = this._controller.getRequestInstance(target_instance_id);
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
			return await this.forwardRequestToInstance(message, request);
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
			this._controller.forwardRequestToInstance(libLink.messages.pushSave, {
				instance_id,
				stream_id: stream.id,
				save: source_save,
			}),
			events.once(stream.events, "source"),
		]);

		// Establish pull from target host to stream and wait for completion.
		let result = await this._controller.forwardRequestToInstance(libLink.messages.pullSave, {
			instance_id: target_instance_id,
			stream_id: stream.id,
			filename: target_save,
		});

		// Delete source save if this is not a copy
		if (!copy) {
			await this._controller.forwardRequestToInstance(libLink.messages.deleteSave, {
				instance_id,
				save: source_save,
			});
		}

		return { save: result.save };
	}

	async listModPacksRequestHandler(message) {
		return { list: [...this._controller.modPacks.values()].map(pack => pack.toJSON()) };
	}

	async setModPackSubscriptionsRequestHandler(message) {
		this.modPackSubscriptions = message.data;
	}

	async createModPackRequestHandler(message) {
		let modPack = new libData.ModPack(message.data.mod_pack);
		if (this._controller.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} already exist`);
		}
		this._controller.modPacks.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async updateModPackRequestHandler(message) {
		let modPack = new libData.ModPack(message.data.mod_pack);
		if (!this._controller.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} does not exist`);
		}
		this._controller.modPacks.set(modPack.id, modPack);
		this._controller.modPackUpdated(modPack);
	}

	async deleteModPackRequestHandler(message) {
		let { id } = message.data;
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
			|| this.modPackSubscriptions.mod_pack_ids.includes(modPack.id)
		) {
			libLink.messages.modPackUpdate.send(this, { mod_pack: modPack.toJSON() });
		}
	}

	async getModRequestHandler(message) {
		let { name, version } = message.data;
		let filename = `${name}_${version}.zip`;
		let mod = this._controller.mods.get(filename);
		if (!mod) {
			throw new libErrors.RequestError(`Mod ${filename} does not exist`);
		}
		return {
			mod: mod.toJSON(),
		};
	}

	async listModsRequestHandler(message) {
		return { list: [...this._controller.mods.values()].map(mod => mod.toJSON()) };
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

	async searchModsRequestHandler(message) {
		let query = libHelpers.parseSearchString(message.data.query, {
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
		let factorioVersion = message.data.factorio_version;

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

		const sort = message.data.sort;
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
			let order = message.data.sort_order;
			if (order === "desc") {
				resultList.reverse();
			}
		}

		const page = message.data.page;
		const pageSize = message.data.page_size || 10;
		resultList = resultList.slice((page - 1) * pageSize, page * pageSize);

		return {
			query_issues: query.issues,
			page_count: Math.ceil(results.size / pageSize),
			result_count: results.size,
			results: resultList,
		};
	}

	async setModSubscriptionsRequestHandler(message) {
		this.modSubscriptions = message.data;
	}

	async downloadModRequestHandler(message) {
		let { name, version } = message.data;
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

		return { stream_id: stream.id };
	}

	async deleteModRequestHandler(message) {
		await this._controller.deleteMod(message.data.name, message.data.version);
	}

	async setLogSubscriptionsRequestHandler(message) {
		this.logSubscriptions = message.data;
		this.updateLogSubscriptions();
	}

	modUpdated(mod) {
		if (
			this.modSubscriptions.all
			|| this.modSubscriptions.mod_names.includes(mod.name)
		) {
			libLink.messages.modUpdate.send(this, { mod: mod.toJSON() });
		}
	}

	updateLogSubscriptions() {
		let { all, controller, host_ids, instance_ids } = this.logSubscriptions;
		if (all || controller || host_ids.length || instance_ids.length) {
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

	async queryLogRequestHandler(message) {
		let observeDuration = queryLogTime.startTimer();
		let { all, controller, host_ids, instance_ids } = message.data;

		let log;
		if (!all && controller && !host_ids.length && !instance_ids.length) {
			log = await this._controller.queryControllerLog(message.data);
		} else {
			log = await this._controller.queryClusterLog(message.data);
		}

		observeDuration();
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
		for (let role of this._controller.userManager.roles.values()) {
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
		let lastId = Math.max.apply(null, [...this._controller.userManager.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		this._controller.userManager.roles.set(id, new libUsers.Role({ id, ...message.data }));
		return { id };
	}

	async updateRoleRequestHandler(message) {
		let { id, name, description, permissions } = message.data;
		let role = this._controller.userManager.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
		this._controller.rolePermissionsUpdated(role);
	}

	async grantDefaultRolePermissionsRequestHandler(message) {
		let role = this._controller.userManager.roles.get(message.data.id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${message.data.id} does not exist`);
		}

		role.grantDefaultPermissions();
		this._controller.rolePermissionsUpdated(role);
	}

	async deleteRoleRequestHandler(message) {
		let id = message.data.id;
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

	async getUserRequestHandler(message) {
		let name = message.data.name;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			throw new libErrors.RequestError(`User ${name} does not exist`);
		}

		return {
			name: user.name,
			roles: [...user.roles].map(role => role.id),
			is_admin: user.isAdmin,
			is_banned: user.isBanned,
			is_whitelisted: user.isWhitelisted,
			ban_reason: user.banReason,
			instances: [...user.instances],
			player_stats: user.playerStats,
			instance_stats: [...user.instanceStats],
		};
	}

	async listUsersRequestHandler(message) {
		let list = [];
		for (let user of this._controller.userManager.users.values()) {
			list.push({
				name: user.name,
				roles: [...user.roles].map(role => role.id),
				is_admin: user.isAdmin,
				is_banned: user.isBanned,
				is_whitelisted: user.isWhitelisted,
				instances: [...user.instances],
				player_stats: user.playerStats,
			});
		}
		return { list };
	}

	async setUserSubscriptionsRequestHandler(message) {
		this.userSubscriptions = message.data;
	}

	userUpdated(user) {
		if (
			this.userSubscriptions.all
			|| this.userSubscriptions.names.includes(user.name)
		) {
			libLink.messages.userUpdate.send(this, {
				name: user.name,
				roles: [...user.roles].map(role => role.id),
				is_admin: user.isAdmin,
				is_banned: user.isBanned,
				is_whitelisted: user.isWhitelisted,
				ban_reason: user.banReason,
				instances: [...user.instances],
				player_stats: user.playerStats,
				instance_stats: [...user.instanceStats],
				is_deleted: user.isDeleted,
			});
		}
	}

	async createUserRequestHandler(message) {
		let user = this._controller.userManager.createUser(message.data.name);
		this._controller.userUpdated(user);
	}

	async revokeUserTokenRequestHandler(message) {
		let user = this._controller.userManager.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}
		if (user.name !== this.user.name) {
			this.user.checkPermission("core.user.revoke_other_token");
		}

		user.invalidateToken();
		for (let controlConnection of this._controller.wsServer.controlConnections) {
			if (controlConnection.user.name === user.name) {
				controlConnection.connector.terminate();
			}
		}
		this._controller.userUpdated(user);
	}

	async updateUserRolesRequestHandler(message) {
		let user = this._controller.userManager.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		let resolvedRoles = new Set();
		for (let roleId of message.data.roles) {
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

	async setUserAdminRequestHandler(message) {
		let { name, create, admin } = message.data;
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
		this.broadcastEventToHosts({ data: { name, admin }}, libLink.messages.adminlistUpdate);
	}

	async setUserBannedRequestHandler(message) {
		let { name, create, banned, reason } = message.data;
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
		this.broadcastEventToHosts({ data: { name, banned, reason }}, libLink.messages.banlistUpdate);
	}

	async setUserWhitelistedRequestHandler(message) {
		let { name, create, whitelisted } = message.data;
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
		this.broadcastEventToHosts({ data: { name, whitelisted }}, libLink.messages.whitelistUpdate);
	}

	async deleteUserRequestHandler(message) {
		let user = this._controller.userManager.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		user.isDeleted = true;
		this._controller.userManager.users.delete(message.data.name);
		this._controller.userUpdated(user);

		if (user.is_admin) {
			this.broadcastEventToHosts({ data: { name, admin: false }}, libLink.messages.adminlistUpdate);
		}
		if (user.is_whitelisted) {
			this.broadcastEventToHosts({ data: { name, whitelisted: false }}, libLink.messages.whitelistUpdate);
		}
		if (user.is_banned) {
			this.broadcastEventToHosts({ data: { name, banned: false, reason: "" }}, libLink.messages.banlistUpdate);
		}
	}

	async debugDumpWsRequestHandler(message) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				libLink.messages.debugWsMessage.send(this, data);
			}
		};
		this.connector._socket.clusterio_ignore_dump = true;
		this._controller.debugEvents.on("message", this.ws_dumper);
	}
}

module.exports = ControlConnection;
