"use strict";
const lib = require("@clusterio/lib");
const { BaseInstancePlugin } = require("@clusterio/host");
//%if multi_context
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");
//%endif

class InstancePlugin extends BaseInstancePlugin {
//%if multi_context | module
	async init() {
//%if multi_context
		this.instance.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.instance.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%endif
//%if module
		this.instance.server.handle("__plugin_name__-plugin_example_ipc", this.handlePluginExampleIPC.bind(this));
//%endif
//%if multi_context | module
	}
//%endif

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
//%if module
		if (this.instance.status === "running") {
			await this.sendRcon("/sc __plugin_name__.foo()");
		}
//%endif
	}
//%if multi_context

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
//%endif
//%if module

	async handlePluginExampleIPC(event) {
		this.logger.info(JSON.stringify(event));
	}
//%endif
}

module.exports = {
	InstancePlugin,
};
