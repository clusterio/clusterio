"use strict";
const lib = require("@clusterio/lib");
const { BaseInstancePlugin } = require("@clusterio/host");
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");

class InstancePlugin extends BaseInstancePlugin {
	async init() {
		this.instance.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.instance.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%if module
		this.instance.server.handle("__plugin_name__-plugin_example_ipc", this.handlePluginExampleIPC.bind(this));
//%endif
	}

	async onInstanceConfigFieldChanged(field, curr, prev) {
		this.logger.info(`instance::onInstanceConfigFieldChanged ${field}`);
	}

	async onStart() {
		this.logger.info("instance::onStart");
	}

	async onStop() {
		this.logger.info("instance::onStop");
	}

	async onPlayerEvent(event) {
		this.logger.info(`onPlayerEvent::onPlayerEvent ${JSON.stringify(event)}`);
	}

	async handlePluginExampleEvent(event) {
		this.logger.info(JSON.stringify(event));
//%if module
		this.sendRcon("/sc __plugin_name__.foo()");
//%endif
	}

	async handlePluginExampleRequest(request) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
//%if module

	async handlePluginExampleIPC(event) {
		this.logger.info(JSON.stringify(event));
	}
//%endif
}

module.exports = {
	InstancePlugin,
};
