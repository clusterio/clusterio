"use strict";
const { BaseHostPlugin } = require("@clusterio/host");

const { HostEcho, HostEchoReceived } = require("./messages");

class HostPlugin extends BaseHostPlugin {
	async init() {
		this.logger.info("test_plugin host loaded");
		this.receivedEchoes = new Set();
		this.host.handle(HostEcho, this.handleHostEcho.bind(this));
		this.host.handle(HostEchoReceived, this.handleHostEchoReceived.bind(this));
	}

	async handleHostEcho(event) {
		this.logger.info(`test_plugin host echo ${event.text}`);
		this.receivedEchoes.add(event.text);
	}

	async handleHostEchoReceived(request) {
		return this.receivedEchoes.has(request.text);
	}
}

module.exports = {
	HostPlugin,
};
