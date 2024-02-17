"use strict";
const lib = require("@clusterio/lib");
const { BaseControllerPlugin } = require("@clusterio/controller");
const { PluginExampleEvent, PluginExampleRequest,/*/ [subscribable] /*/ ExampleSubscribableUpdate, ExampleSubscribableValue/*/ [] /*/ } = require("./messages");

class ControllerPlugin extends BaseControllerPlugin {// [subscribable] //
	exampleDatabase;
	storageDirty = false;
	// [] //
	async init() {
		this.controller.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.controller.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));// [subscribable] //
		this.controller.subscriptions.handle(ExampleSubscribableUpdate, this.handleExampleSubscription.bind(this));
		this.exampleDatabase = new Map(); // If needed, replace with loading from database file // [] //
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
	}// [subscribable] //

	async handleExampleSubscription(request) {
		const values = [...this.exampleDatabase.values()].filter(
			value => value.updatedAtMs > request.lastRequestTimeMs,
		);
		return values.length ? new ExampleSubscribableUpdate(values) : null;
	}// [] //
}

module.exports = {
	ControllerPlugin,
};
