"use strict";
const lib = require("@clusterio/lib");
const { BaseControllerPlugin } = require("@clusterio/controller");
const { PluginExampleEvent, PluginExampleRequest } = require("./messages");

class ControllerPlugin extends BaseControllerPlugin {
	async init() {
		this.controller.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.controller.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
	}

	async onControllerConfigFieldChanged(field, curr, prev) {
		this.logger.info(`controller::onControllerConfigFieldChanged ${field}`);
	}// [instance] //

	async onInstanceConfigFieldChanged(instance, field, curr, prev) {
		this.logger.info(`controller::onInstanceConfigFieldChanged ${instance.id} ${field}`);
	}// [] //

	async onSaveData() {
		this.logger.info("controller::onSaveData");
	}

	async onShutdown() {
		this.logger.info("controller::onShutdown");
	}

	async onPlayerEvent(instance, event) {
		this.logger.info(`controller::onPlayerEvent ${instance.id} ${JSON.stringify(event)}`);
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
	ControllerPlugin,
};
