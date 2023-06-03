"use strict";
const libData = require("@clusterio/lib/data");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libErrors = require("@clusterio/lib/errors");


class InstanceConnection extends libLink.Link {
	constructor(connector, host, instanceId) {
		super(connector);
		this.host = host;
		this.router = this.host.router;
		this.instanceId = instanceId;
		this.plugins = new Map();
		this.status = "stopped";

		this.handle(libData.InstanceInitialisedEvent, this.handleInstanceInitialisedEvent.bind(this));
		this.snoopEvent(libData.InstanceStatusChangedEvent, this.snoopInstanceStatusChangedEvent.bind(this));
	}

	async broadcastEventToInstance(message, event) {
		for (let instanceConnection of this.host.instanceConnections.values()) {
			// Do not broadcast back to the source
			if (instanceConnection === this) { continue; }
			if (event.plugin && !instanceConnection.plugins.has(event.plugin)) { continue; }

			event.send(instanceConnection, message.data);
		}
	}

	async handleInstanceInitialisedEvent(event) {
		this.plugins = new Map(Object.entries(event.plugins));
	}

	async snoopInstanceStatusChangedEvent(event) {
		this.status = event.status;
		if (this.status === "stopped") {
			this.host.instanceConnections.delete(this.instanceId);
		}
	}
}

module.exports = InstanceConnection;
