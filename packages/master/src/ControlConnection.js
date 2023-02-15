"use strict";
const events = require("events");
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");
const path = require("path");

const libConfig = require("@clusterio/lib/config");
const libData = require("@clusterio/lib/data");
const libErrors = require("@clusterio/lib/errors");
const libHelpers = require("@clusterio/lib/helpers");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");
const libLoggingUtils = require("@clusterio/lib/logging_utils");
const libPlugin = require("@clusterio/lib/plugin");
const libPrometheus = require("@clusterio/lib/prometheus");
const libUsers = require("@clusterio/lib/users");

const BaseConnection = require("./BaseConnection");
const routes = require("./routes");

const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

const lastQueryLogTime = new libPrometheus.Gauge(
	"clusterio_master_last_query_log_duration_seconds",
	"Time in seconds the last log query took to execute."
);

/**
 * Represents the connection to a control link
 *
 * @extends module:master/src/BaseConnection
 * @alias module:master/src/ControlConnection
 */
class ControlConnection extends BaseConnection {
	constructor(registerData, connector, master, user) {
		super("control", connector, master);

		this._agent = registerData.agent;
		this._version = registerData.version;

		/**
		 * The user making this connection.
		 * @type {module:lib/users.User}
		 */
		this.user = user;

		this.slaveSubscriptions = {
			all: false,
			slave_ids: [],
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
				this._master.debugEvents.off("message", this.ws_dumper);
			}
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let masterPlugin of this._master.plugins.values()) {
					masterPlugin.onControlConnectionEvent(this, event);
				}
			});
		}
	}

	async getMasterConfigRequestHandler() {
		return { serialized_config: this._master.config.serialize("control") };
	}

	async setMasterConfigFieldRequestHandler(message) {
		this._master.config.set(message.data.field, message.data.value, "control");
	}

	async setMasterConfigPropRequestHandler(message) {
		let { field, prop, value } = message.data;
		this._master.config.setProp(field, prop, value, "control");
	}

	async listSlavesRequestHandler(message) {
		let list = [];
		for (let slave of this._master.slaves.values()) {
			list.push({
				agent: slave.agent,
				version: slave.version,
				id: slave.id,
				name: slave.name,
				public_address: slave.public_address || null,
				connected: this._master.wsServer.slaveConnections.has(slave.id),
			});
		}
		return { list };
	}

	async setSlaveSubscriptionsRequestHandler(message) {
		this.slaveSubscriptions = message.data;
	}

	slaveUpdated(slave, update) {
		if (
			this.slaveSubscriptions.all
			|| this.slaveSubscriptions.slave_ids.includes(slave.id)
		) {
			libLink.messages.slaveUpdate.send(this, update);
		}
	}

	generateSlaveToken(slaveId) {
		return jwt.sign(
			{ aud: "slave", slave: slaveId },
			Buffer.from(this._master.config.get("master.auth_secret"), "base64")
		);
	}

	async generateSlaveTokenRequestHandler(message) {
		let slaveId = message.data.slave_id;
		if (slaveId === null) {
			slaveId = Math.random() * 2**31 | 0;
		}
		return { token: this.generateSlaveToken(slaveId) };
	}

	async createSlaveConfigRequestHandler(message) {
		let slaveConfig = new libConfig.SlaveConfig("control");
		await slaveConfig.init();

		slaveConfig.set("slave.master_url", this._master.getMasterUrl());
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

	async getInstanceRequestHandler(message) {
		let id = message.data.id;
		let instance = this._master.getRequestInstance(id);

		return {
			id,
			name: instance.config.get("instance.name"),
			assigned_slave: instance.config.get("instance.assigned_slave"),
			game_port: instance.game_port || null,
			status: instance.status,
		};
	}

	async listInstancesRequestHandler(message) {
		let list = [];
		for (let instance of this._master.instances.values()) {
			list.push({
				id: instance.config.get("instance.id"),
				name: instance.config.get("instance.name"),
				assigned_slave: instance.config.get("instance.assigned_slave"),
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
				assigned_slave: instance.config.get("instance.assigned_slave"),
				game_port: instance.game_port || null,
				status: instance.status,
			});
		}
	}

	// XXX should probably add a hook for slave reuqests?
	async createInstanceRequestHandler(message) {
		let instanceConfig = new libConfig.InstanceConfig("master");
		await instanceConfig.load(message.data.serialized_config);

		let instanceId = instanceConfig.get("instance.id");
		if (this._master.instances.has(instanceId)) {
			throw new libErrors.RequestError(`Instance with ID ${instanceId} already exists`);
		}

		// Add common settings for the Factorio server
		let settings = {
			"name": `${this._master.config.get("master.name")} - ${instanceConfig.get("instance.name")}`,
			"description": `Clusterio instance for ${this._master.config.get("master.name")}`,
			"tags": ["clusterio"],
			"max_players": 0,
			"visibility": { "public": true, "lan": true },
			"username": "",
			"token": "",
			"game_password": "",
			"require_user_verification": true,
			"max_upload_in_kilobytes_per_second": 0,
			"max_upload_slots": 5,
			"ignore_player_limit_for_returning_players": false,
			"allow_commands": "admins-only",
			"autosave_interval": 10,
			"autosave_slots": 5,
			"afk_autokick_interval": 0,
			"auto_pause": false,
			"only_admins_can_pause_the_game": true,
			"autosave_only_on_server": true,

			...instanceConfig.get("factorio.settings"),
		};
		instanceConfig.set("factorio.settings", settings);

		let instance = { config: instanceConfig, status: "unassigned" };
		this._master.instances.set(instanceId, instance);
		await libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", instance, null);
		this._master.addInstanceHooks(instance);
	}

	async deleteInstanceRequestHandler(message, request) {
		let instance = this._master.getRequestInstance(message.data.instance_id);
		if (instance.config.get("instance.assigned_slave") !== null) {
			await this.forwardRequestToInstance(message, request);
		}
		this._master.instances.delete(message.data.instance_id);

		let prev = instance.status;
		instance.status = "deleted";
		this._master.instanceUpdated(instance);
		await libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", instance, prev);
	}

	async getInstanceConfigRequestHandler(message) {
		let instance = this._master.getRequestInstance(message.data.instance_id);
		return {
			serialized_config: instance.config.serialize("control"),
		};
	}

	async updateInstanceConfig(instance) {
		let slaveId = instance.config.get("instance.assigned_slave");
		if (slaveId) {
			let connection = this._master.wsServer.slaveConnections.get(slaveId);
			if (connection) {
				await libLink.messages.assignInstance.send(connection, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize("slave"),
				});
			}
		}
	}

	async setInstanceConfigFieldRequestHandler(message) {
		let instance = this._master.getRequestInstance(message.data.instance_id);
		if (message.data.field === "instance.assigned_slave") {
			throw new libErrors.RequestError("instance.assigned_slave must be set through the assign-slave interface");
		}

		if (message.data.field === "instance.id") {
			// XXX is this worth implementing?  It's race condition galore.
			throw new libErrors.RequestError("Setting instance.id is not supported");
		}

		instance.config.set(message.data.field, message.data.value, "control");
		await this.updateInstanceConfig(instance);
	}

	async setInstanceConfigPropRequestHandler(message) {
		let instance = this._master.getRequestInstance(message.data.instance_id);
		let { field, prop, value } = message.data;
		instance.config.setProp(field, prop, value, "control");
		await this.updateInstanceConfig(instance);
	}

	async assignInstanceCommandRequestHandler(message, request) {
		let { slave_id, instance_id } = message.data;
		let instance = this._master.getRequestInstance(instance_id);

		// Check if target slave is connected
		let newSlaveConnection;
		if (slave_id !== null) {
			newSlaveConnection = this._master.wsServer.slaveConnections.get(slave_id);
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
			let oldSlaveConnection = this._master.wsServer.slaveConnections.get(currentAssignedSlave);
			if (oldSlaveConnection && !oldSlaveConnection.connector.closing) {
				await libLink.messages.unassignInstance.send(oldSlaveConnection, { instance_id });
			}
		}

		// Assign to target
		instance.config.set("instance.assigned_slave", slave_id);
		if (slave_id !== null) {
			await libLink.messages.assignInstance.send(newSlaveConnection, {
				instance_id,
				serialized_config: instance.config.serialize("slave"),
			});
		}
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
		let stream = await routes.createProxyStream(this._master.app);
		stream.filename = save;

		let ready = new Promise((resolve, reject) => {
			stream.events.on("source", resolve);
			stream.events.on("timeout", () => reject(
				new libErrors.RequestError("Timed out establishing stream from slave")
			));
		});
		ready.catch(() => {});

		await this._master.forwardRequestToInstance(libLink.messages.pushSave, {
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
		let sourceInstance = this._master.getRequestInstance(instance_id);
		let targetInstance = this._master.getRequestInstance(target_instance_id);
		let sourceSlaveId = sourceInstance.config.get("instance.assigned_slave");
		let targetSlaveId = targetInstance.config.get("instance.assigned_slave");
		if (sourceSlaveId === null) {
			throw new libErrors.RequestError("Source instance is not assigned a slave");
		}
		if (targetSlaveId === null) {
			throw new libErrors.RequestError("Target instance is not assigned a slave");
		}

		// Let slave handle request if source and target is on the same slave.
		if (sourceSlaveId === targetSlaveId) {
			return await this.forwardRequestToInstance(message, request);
		}

		// Check connectivity
		let sourceSlaveConnection = this._master.wsServer.slaveConnections.get(sourceSlaveId);
		if (!sourceSlaveConnection || sourceSlaveConnection.closing) {
			throw new libErrors.RequestError("Source slave is not connected to the master server");
		}

		let targetSlaveConnection = this._master.wsServer.slaveConnections.get(targetSlaveId);
		if (!targetSlaveConnection || targetSlaveConnection.closing) {
			throw new libErrors.RequestError("Target slave is not connected to the master server");
		}

		// Create stream to proxy from target to source
		let stream = await routes.createProxyStream(this._master.app);
		stream.events.on("timeout", () => {
			if (stream.source) {
				stream.source.destroy();
			}
			stream.events.emit("error", new libErrors.RequestError("Timed out establishing transfer stream"));
		});

		// Ignore errors if not listening for them to avoid crash.
		stream.events.on("error", () => { /* ignore */ });

		// Establish push from source slave to stream, this is done first to
		// ensure the file size is known prior to the target slave pull.
		await Promise.all([
			this._master.forwardRequestToInstance(libLink.messages.pushSave, {
				instance_id,
				stream_id: stream.id,
				save: source_save,
			}),
			events.once(stream.events, "source"),
		]);

		// Establish pull from target slave to stream and wait for completion.
		let result = await this._master.forwardRequestToInstance(libLink.messages.pullSave, {
			instance_id: target_instance_id,
			stream_id: stream.id,
			filename: target_save,
		});

		// Delete source save if this is not a copy
		if (!copy) {
			await this._master.forwardRequestToInstance(libLink.messages.deleteSave, {
				instance_id,
				save: source_save,
			});
		}

		return { save: result.save };
	}

	async listModPacksRequestHandler(message) {
		return { list: [...this._master.modPacks.values()].map(pack => pack.toJSON()) };
	}

	async setModPackSubscriptionsRequestHandler(message) {
		this.modPackSubscriptions = message.data;
	}

	async createModPackRequestHandler(message) {
		let modPack = new libData.ModPack(message.data.mod_pack);
		if (this._master.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} already exist`);
		}
		this._master.modPacks.set(modPack.id, modPack);
		this._master.modPackUpdated(modPack);
	}

	async updateModPackRequestHandler(message) {
		let modPack = new libData.ModPack(message.data.mod_pack);
		if (!this._master.modPacks.has(modPack.id)) {
			throw new libErrors.RequestError(`Mod pack with ID ${modPack.id} does not exist`);
		}
		this._master.modPacks.set(modPack.id, modPack);
		this._master.modPackUpdated(modPack);
	}

	async deleteModPackRequestHandler(message) {
		let { id } = message.data;
		let modPack = this._master.modPacks.get(id);
		if (!modPack) {
			throw new libErrors.RequestError(`Mod pack with ID ${id} does not exist`);
		}
		modPack.isDeleted = true;
		this._master.modPacks.delete(id);
		this._master.modPackUpdated(modPack);
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
		let mod = this._master.mods.get(filename);
		if (!mod) {
			throw new libErrors.RequestError(`Mod ${filename} does not exist`);
		}
		return {
			mod: mod.toJSON(),
		};
	}

	async listModsRequestHandler(message) {
		return { list: [...this._master.mods.values()].map(mod => mod.toJSON()) };
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
		for (let mod of this._master.mods.values()) {
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
		let mod = this._master.mods.get(filename);
		if (!mod) {
			throw new libErrors.RequestError(`Mod ${filename} does not exist`);
		}
		let modPath = path.join(this._master.config.get("master.mods_directory"), mod.filename);

		let stream = await routes.createProxyStream(this._master.app);
		stream.filename = mod.filename;
		stream.source = fs.createReadStream(modPath);
		stream.mime = "application/zip";
		stream.size = mod.size;

		return { stream_id: stream.id };
	}

	async deleteModRequestHandler(message) {
		await this._master.deleteMod(message.data.name, message.data.version);
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
		let { all, master, slave_ids, instance_ids } = this.logSubscriptions;
		if (all || master || slave_ids.length || instance_ids.length) {
			if (!this.logTransport) {
				this.logTransport = new libLoggingUtils.LinkTransport({ link: this });
				this._master.clusterLogger.add(this.logTransport);
			}
			this.logTransport.filter = libLoggingUtils.logFilter(this.logSubscriptions);

		} else if (this.logTransport) {
			this._master.clusterLogger.remove(this.logTransport);
			this.logTransport = null;
		}
	}

	async queryLogRequestHandler(message) {
		let setDuration = lastQueryLogTime.startTimer();
		let { all, master, slave_ids, instance_ids } = message.data;

		let log;
		if (!all && master && !slave_ids.length && !instance_ids.length) {
			log = await this._master.queryMasterLog(message.data);
		} else {
			log = await this._master.queryClusterLog(message.data);
		}

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
		for (let role of this._master.userManager.roles.values()) {
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
		let lastId = Math.max.apply(null, [...this._master.userManager.roles.keys()]);

		// Start at 5 to leave space for future default roles
		let id = Math.max(5, lastId+1);
		this._master.userManager.roles.set(id, new libUsers.Role({ id, ...message.data }));
		return { id };
	}

	async updateRoleRequestHandler(message) {
		let { id, name, description, permissions } = message.data;
		let role = this._master.userManager.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		role.name = name;
		role.description = description;
		role.permissions = new Set(permissions);
		this._master.rolePermissionsUpdated(role);
	}

	async grantDefaultRolePermissionsRequestHandler(message) {
		let role = this._master.userManager.roles.get(message.data.id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${message.data.id} does not exist`);
		}

		role.grantDefaultPermissions();
		this._master.rolePermissionsUpdated(role);
	}

	async deleteRoleRequestHandler(message) {
		let id = message.data.id;
		let role = this._master.userManager.roles.get(id);
		if (!role) {
			throw new libErrors.RequestError(`Role with ID ${id} does not exist`);
		}

		this._master.userManager.roles.delete(id);
		for (let user of this._master.userManager.users.values()) {
			user.roles.delete(role);
			this._master.userPermissionsUpdated(user);
		}
	}

	async getUserRequestHandler(message) {
		let name = message.data.name;
		let user = this._master.userManager.users.get(name);
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
		for (let user of this._master.userManager.users.values()) {
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
		let user = this._master.userManager.createUser(message.data.name);
		this._master.userUpdated(user);
	}

	async updateUserRolesRequestHandler(message) {
		let user = this._master.userManager.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		let resolvedRoles = new Set();
		for (let roleId of message.data.roles) {
			let role = this._master.userManager.roles.get(roleId);
			if (!role) {
				throw new libErrors.RequestError(`Role with ID ${roleId} does not exist`);
			}

			resolvedRoles.add(role);
		}

		user.roles = resolvedRoles;
		this._master.userPermissionsUpdated(user);
		this._master.userUpdated(user);
	}

	async setUserAdminRequestHandler(message) {
		let { name, create, admin } = message.data;
		let user = this._master.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._master.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isAdmin = admin;
		this._master.userUpdated(user);
		this.broadcastEventToSlaves({ data: { name, admin }}, libLink.messages.adminlistUpdate);
	}

	async setUserBannedRequestHandler(message) {
		let { name, create, banned, reason } = message.data;
		let user = this._master.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._master.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isBanned = banned;
		user.banReason = reason;
		this._master.userUpdated(user);
		this.broadcastEventToSlaves({ data: { name, banned, reason }}, libLink.messages.banlistUpdate);
	}

	async setUserWhitelistedRequestHandler(message) {
		let { name, create, whitelisted } = message.data;
		let user = this._master.userManager.users.get(name);
		if (!user) {
			if (create) {
				this.user.checkPermission("core.user.create");
				user = this._master.userManager.createUser(name);
			} else {
				throw new libErrors.RequestError(`User '${name}' does not exist`);
			}
		}

		user.isWhitelisted = whitelisted;
		this._master.userUpdated(user);
		this.broadcastEventToSlaves({ data: { name, whitelisted }}, libLink.messages.whitelistUpdate);
	}

	async deleteUserRequestHandler(message) {
		let user = this._master.userManager.users.get(message.data.name);
		if (!user) {
			throw new libErrors.RequestError(`User '${message.data.name}' does not exist`);
		}

		user.isDeleted = true;
		this._master.userManager.users.delete(message.data.name);
		this._master.userUpdated(user);

		if (user.is_admin) {
			this.broadcastEventToSlaves({ data: { name, admin: false }}, libLink.messages.adminlistUpdate);
		}
		if (user.is_whitelisted) {
			this.broadcastEventToSlaves({ data: { name, whitelisted: false }}, libLink.messages.whitelistUpdate);
		}
		if (user.is_banned) {
			this.broadcastEventToSlaves({ data: { name, banned: false, reason: "" }}, libLink.messages.banlistUpdate);
		}
	}

	async debugDumpWsRequestHandler(message) {
		this.ws_dumper = data => {
			if (this.connector.connected) {
				libLink.messages.debugWsMessage.send(this, data);
			}
		};
		this.connector._socket.clusterio_ignore_dump = true;
		this._master.debugEvents.on("message", this.ws_dumper);
	}
}

module.exports = ControlConnection;
