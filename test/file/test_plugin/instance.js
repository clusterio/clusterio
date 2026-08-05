"use strict";
const { BaseInstancePlugin } = require("@clusterio/host");

class InstancePlugin extends BaseInstancePlugin {
	async init() {
		this.logger.info("test_plugin instance loaded");
	}
}

module.exports = {
	InstancePlugin,
};
