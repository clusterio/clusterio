"use strict";
const { BaseControllerPlugin } = require("@clusterio/controller");

const { ControllerEcho, HostEcho } = require("./messages");

class ControllerPlugin extends BaseControllerPlugin {
	async init() {
		this.logger.info("test_plugin controller loaded");
		this.controller.handle(ControllerEcho, this.handleControllerEcho.bind(this));
	}

	async handleControllerEcho(request) {
		this.logger.info(`test_plugin controller echo ${request.text}`);
		this.broadcastEventToHosts(new HostEcho(request.text));
		return request.text;
	}
}

module.exports = {
	ControllerPlugin,
};
