"use strict";
const lib = require("@clusterio/lib");
const { BaseHostPlugin } = require("@clusterio/host");
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");

class HostPlugin extends BaseHostPlugin {
	async init() {
		this.host.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.host.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
	}

	async onHostConfigFieldChanged(field, curr, prev) {
		this.logger.info(`host::onInstanceConfigFieldChanged ${field}`);
	}

	async onShutdown() {
		this.logger.info("host::onShutdown");
	}

	async handlePluginExampleEvent(event) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
}

module.exports = {
	HostPlugin,
};
