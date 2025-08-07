"use strict";
const lib = require("@clusterio/lib");
const { BaseControllerPlugin } = require("@clusterio/controller");
//%if multi_context // Messages requires multi context

const {
	PluginExampleEvent, PluginExampleRequest,
//%endif
//%if controller & web // Subscribing requires web content and the controller
	ExampleSubscribableUpdate, ExampleSubscribableValue,
//%endif
//%if multi_context // Messages requires multi context
} = require("./messages");
//%endif

class ControllerPlugin extends BaseControllerPlugin {
//%if controller & web // Subscribing requires web content and the controller
	exampleDatabase;
	storageDirty = false;

//%endif
//%if multi_context // Subscribing requires multi context
	async init() {
		this.controller.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.controller.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%endif
//%if controller & web // Subscribing requires web content and the controller
		this.controller.subscriptions.handle(ExampleSubscribableUpdate, this.handleExampleSubscription.bind(this));
		// If needed, replace with loading from database file such as lib.Datastore
		this.exampleDatabase = new Map([["foo", new ExampleSubscribableValue("foo", 0, false)]]);
//%endif
//%if multi_context // Subscribing requires multi context
	}
//%endif

	async onControllerConfigFieldChanged(field, curr, prev) {
		this.logger.info(`controller::onControllerConfigFieldChanged ${field}`);
	}
//%if instance

	async onInstanceConfigFieldChanged(instance, field, curr, prev) {
		this.logger.info(`controller::onInstanceConfigFieldChanged ${instance.id} ${field}`);
	}
//%endif

	async onSaveData() {
		this.logger.info("controller::onSaveData");
	}

	async onShutdown() {
		this.logger.info("controller::onShutdown");
	}

	async onPlayerEvent(instance, event) {
		this.logger.info(`controller::onPlayerEvent ${instance.id} ${JSON.stringify(event)}`);
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
//%if controller & web // Subscribing requires web content and the controller

	async handleExampleSubscription(request) {
		this.logger.info(JSON.stringify(request));
		const values = [...this.exampleDatabase.values()].filter(
			value => value.updatedAtMs > request.lastRequestTimeMs,
		);
		return values.length ? new ExampleSubscribableUpdate(values) : null;
	}
//%endif
}

module.exports = {
	ControllerPlugin,
};
