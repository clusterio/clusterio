"use strict";
const libConfig = require("@clusterio/lib/config");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");
const libPlugin = require("@clusterio/lib/plugin");
const PlayerStats = require("@clusterio/lib/PlayerStats");

const BaseConnection = require("./BaseConnection");


/**
 * Represents the connection to a slave
 *
 * @extends module:controller/src/BaseConnection
 * @alias module:controller/src/SlaveConnection
 */
class SlaveConnection extends BaseConnection {
	constructor(registerData, connector, controller) {
		super("slave", connector, controller);

		this._agent = registerData.agent;
		this._id = registerData.id;
		this._name = registerData.name;
		this._version = registerData.version;
		this.plugins = new Map(Object.entries(registerData.plugins));
		this._checkPluginVersions();

		this._controller.slaves.set(this._id, {
			agent: this._agent,
			id: this._id,
			name: this._name,
			version: this._version,
			public_address: registerData.public_address,
			plugins: registerData.plugins,
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			// eslint-disable-next-line no-loop-func
			this.connector.on(event, () => {
				for (let plugin of this._controller.plugins.values()) {
					plugin.onSlaveConnectionEvent(this, event);
				}
			});
		}

		this.connector.on("close", () => {
			// Update status to unknown for instances on this slave.
			for (let instance of this._controller.instances.values()) {
				if (instance.config.get("instance.assigned_slave") !== this._id) {
					continue;
				}

				let prev = instance.status;
				instance.status = "unknown";
				this._controller.instanceUpdated(instance);
				libPlugin.invokeHook(this._controller.plugins, "onInstanceStatusChanged", instance, prev);
			}
		});
	}

	_checkPluginVersions() {
		let pluginInfos = new Map(this._controller.pluginInfos.map(i => [i.name, i]));
		for (let [name, version] of this.plugins) {
			let info = pluginInfos.get(name);
			if (!info) {
				logger.warn(`Slave ${this._name} has plugin ${name} ${version} which the controller does not have`);
				continue;
			}

			if (info.version !== version) {
				logger.warn(
					`Slave ${this._name} has plugin ${name} ${version} which does not match the version of this ` +
					`plugin on the controller (${info.version})`
				);
			}
		}

		for (let [name, info] of pluginInfos) {
			if (!this.plugins.has(name)) {
				logger.warn(`Slave ${this._name} is missing plugin ${name} ${info.version}`);
			}
		}
	}

	/**
	 * ID of the slave this connection is connected to
	 *
	 * @returns {number} slave ID.
	 */
	get id() {
		return this._id;
	}

	async instanceStatusChangedEventHandler(message, event) {
		let instance = this._controller.instances.get(message.data.instance_id);

		// It's possible to get updates from an instance that does not exist
		// or is not assigned to the slave it originated from if it was
		// reassigned or deleted while the connection to the slave it was
		// originally on was down at the time.
		if (!instance || instance.config.get("instance.assigned_slave") !== this._id) {
			logger.warn(`Got bogus update for instance id ${message.data.instance_id}`);
			return;
		}

		// We may receive status changed where the status hasn't changed
		// from our perspective if the connection was down at the time it
		// changed.  Slaves also send status updates on assignInstance which
		// for hacky reason is also used to push config changes and
		// restablish status after a connection loss.
		if (instance.status === message.data.status) {
			return;
		}

		let prev = instance.status;
		instance.status = message.data.status;
		instance.game_port = message.data.game_port;
		logger.verbose(`Instance ${instance.config.get("instance.name")} State: ${instance.status}`);
		this._controller.instanceUpdated(instance);
		await libPlugin.invokeHook(this._controller.plugins, "onInstanceStatusChanged", instance, prev);
	}

	async updateInstancesRequestHandler(message) {
		// Push updated instance configs
		for (let instance of this._controller.instances.values()) {
			if (instance.config.get("instance.assigned_slave") === this._id) {
				await libLink.messages.assignInstance.send(this, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize("slave"),
				});
			}
		}

		// Assign instances the slave has but controller does not
		for (let instanceData of message.data.instances) {
			let instanceConfig = new libConfig.InstanceConfig("controller");
			await instanceConfig.load(instanceData.serialized_config, "slave");

			let controllerInstance = this._controller.instances.get(instanceConfig.get("instance.id"));
			if (controllerInstance) {
				// Check if this instance is assigned somewhere else.
				if (controllerInstance.config.get("instance.assigned_slave") !== this._id) {
					await libLink.messages.unassignInstance.send(this, {
						instance_id: controllerInstance.config.get("instance.id"),
					});
					continue;
				}

				// Already have this instance, update state instead
				if (controllerInstance.status !== instanceData.status) {
					let prev = controllerInstance.status;
					controllerInstance.status = instanceData.status;
					logger.verbose(`Instance ${instanceConfig.get("instance.name")} State: ${instanceData.status}`);
					this._controller.instanceUpdated(instance);
					await libPlugin.invokeHook(
						this._controller.plugins, "onInstanceStatusChanged", controllerInstance, prev
					);
				}
				continue;
			}

			instanceConfig.set("instance.assigned_slave", this._id);
			let newInstance = { config: instanceConfig, status: instanceData.status };
			this._controller.instances.set(instanceConfig.get("instance.id"), newInstance);
			this._controller.addInstanceHooks(newInstance);
			await libLink.messages.assignInstance.send(this, {
				instance_id: instanceConfig.get("instance.id"),
				serialized_config: instanceConfig.serialize("slave"),
			});
			await libPlugin.invokeHook(this._controller.plugins, "onInstanceStatusChanged", newInstance, null);
		}

		// Push lists to make sure they are in sync.
		let adminlist = [];
		let banlist = [];
		let whitelist = [];

		for (let user of this._controller.userManager.users.values()) {
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

	async saveListUpdateEventHandler(message) {
		this._controller.saveListUpdate(message.data);
	}

	async logMessageEventHandler(message) {
		this._controller.clusterLogger.log({
			...message.data.info,
			slave_id: this._id,
			slave_name: this._name,
		});
	}

	async playerEventEventHandler(message) {
		let { instance_id, name, type, stats } = message.data;
		let user = this._controller.userManager.users.get(name);
		if (!user) {
			user = this._controller.userManager.createUser(name);
		}

		if (type === "join") {
			user.notifyJoin(instance_id);
		} else if (type === "leave") {
			user.notifyLeave(instance_id);
		}
		user.instanceStats.set(instance_id, new PlayerStats(stats));
		user.recalculatePlayerStats();
		this._controller.userUpdated(user);

		delete message.data.stats;
		let instance = this._controller.instances.get(instance_id);
		await libPlugin.invokeHook(this._controller.plugins, "onPlayerEvent", instance, message.data);
	}
}

module.exports = SlaveConnection;
