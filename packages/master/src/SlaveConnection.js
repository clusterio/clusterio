"use strict";
const libConfig = require("@clusterio/lib/config");
const libLink = require("@clusterio/lib/link");
const { logger } = require("@clusterio/lib/logging");
const libPlugin = require("@clusterio/lib/plugin");

const BaseConnection = require("./BaseConnection");


/**
 * Represents the connection to a slave
 *
 * @extends module:master/src/BaseConnection
 * @alias module:master/src/SlaveConnection
 */
class SlaveConnection extends BaseConnection {
	constructor(registerData, connector, master) {
		super("slave", connector, master);

		this._agent = registerData.agent;
		this._id = registerData.id;
		this._name = registerData.name;
		this._version = registerData.version;
		this.plugins = new Map(Object.entries(registerData.plugins));

		this._master.slaves.set(this._id, {
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
				for (let plugin of this._master.plugins.values()) {
					plugin.onSlaveConnectionEvent(this, event);
				}
			});
		}

		this.connector.on("close", () => {
			// Update status to unknown for instances on this slave.
			for (let instance of this._master.instances.values()) {
				if (instance.config.get("instance.assigned_slave") !== this._id) {
					continue;
				}

				let prev = instance.status;
				instance.status = "unknown";
				this._master.instanceUpdated(instance);
				libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", instance, prev);
			}
		});
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
		let instance = this._master.instances.get(message.data.instance_id);

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
		this._master.instanceUpdated(instance);
		await libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", instance, prev);
	}

	async updateInstancesRequestHandler(message) {
		// Push updated instance configs
		for (let instance of this._master.instances.values()) {
			if (instance.config.get("instance.assigned_slave") === this._id) {
				await libLink.messages.assignInstance.send(this, {
					instance_id: instance.config.get("instance.id"),
					serialized_config: instance.config.serialize("slave"),
				});
			}
		}

		// Assign instances the slave has but master does not
		for (let instanceData of message.data.instances) {
			let instanceConfig = new libConfig.InstanceConfig("master");
			await instanceConfig.load(instanceData.serialized_config, "slave");

			let masterInstance = this._master.instances.get(instanceConfig.get("instance.id"));
			if (masterInstance) {
				// Check if this instance is assigned somewhere else.
				if (masterInstance.config.get("instance.assigned_slave") !== this._id) {
					await libLink.messages.unassignInstance.send(this, {
						instance_id: masterInstance.config.get("instance.id"),
					});
					continue;
				}

				// Already have this instance, update state instead
				if (masterInstance.status !== instanceData.status) {
					let prev = masterInstance.status;
					masterInstance.status = instanceData.status;
					logger.verbose(`Instance ${instanceConfig.get("instance.name")} State: ${instanceData.status}`);
					this._master.instanceUpdated(instance);
					await libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", masterInstance, prev);
				}
				continue;
			}

			instanceConfig.set("instance.assigned_slave", this._id);
			let newInstance = { config: instanceConfig, status: instanceData.status };
			this._master.instances.set(instanceConfig.get("instance.id"), newInstance);
			this._master.addInstanceHooks(newInstance);
			await libLink.messages.assignInstance.send(this, {
				instance_id: instanceConfig.get("instance.id"),
				serialized_config: instanceConfig.serialize("slave"),
			});
			await libPlugin.invokeHook(this._master.plugins, "onInstanceStatusChanged", newInstance, null);
		}

		// Push lists to make sure they are in sync.
		let adminlist = [];
		let banlist = [];
		let whitelist = [];

		for (let user of this._master.userManager.users.values()) {
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
		this._master.saveListUpdate(message.data);
	}

	async logMessageEventHandler(message) {
		this._master.clusterLogger.log({
			...message.data.info,
			slave_id: this._id,
			slave_name: this._name,
		});
	}

	async playerEventEventHandler(message) {
		let { instance_id, name, type } = message.data;
		let user = this._master.userManager.users.get(name);
		if (!user) {
			user = this._master.userManager.createUser(name);
		}

		if (type === "join") {
			user.notifyJoin(instance_id);
		} else if (type === "leave") {
			user.notifyLeave(instance_id);
		}
		this._master.userUpdated(user);

		let instance = this._master.instances.get(instance_id);
		await libPlugin.invokeHook(this._master.plugins, "onPlayerEvent", instance, message.data);
	}
}

module.exports = SlaveConnection;
