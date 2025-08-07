import * as lib from "@clusterio/lib";
import { BaseControllerPlugin, InstanceInfo } from "@clusterio/controller";
//%if multi_context // Messages requires multi context

import {
	PluginExampleEvent, PluginExampleRequest,
//%endif
//%if controller & web // Subscribing requires web content and the controller
	ExampleSubscribableUpdate, ExampleSubscribableValue,
//%endif
//%if multi_context // Messages requires multi context
} from "./messages";
//%endif

export class ControllerPlugin extends BaseControllerPlugin {
//%if controller & web // Subscribing requires web content and the controller
	exampleDatabase!: Map<string, ExampleSubscribableValue>;
	storageDirty = false;

//%endif
//%if multi_context // Subscribing requires multi context
	async init() {
		this.controller.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.controller.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%endif
//%if controller & web // Subscribing requires web content and the controller
		this.controller.subscriptions.handle(ExampleSubscribableUpdate, this.handleExampleSubscription.bind(this));
		this.exampleDatabase = new Map(); // If needed, replace with loading from database file such as lib.Datastore
//%endif
//%if multi_context // Subscribing requires multi context
	}
//%endif

	async onControllerConfigFieldChanged(field: string, curr: unknown, prev: unknown) {
		this.logger.info(`controller::onControllerConfigFieldChanged ${field}`);
	}
//%if instance

	async onInstanceConfigFieldChanged(instance: InstanceInfo, field: string, curr: unknown, prev: unknown) {
		this.logger.info(`controller::onInstanceConfigFieldChanged ${instance.id} ${field}`);
	}
//%endif

	async onSaveData() {
		this.logger.info("controller::onSaveData");
	}

	async onShutdown() {
		this.logger.info("controller::onShutdown");
	}

	async onPlayerEvent(instance: InstanceInfo, event: lib.PlayerEvent) {
		this.logger.info(`controller::onPlayerEvent ${instance.id} ${JSON.stringify(event)}`);
	}
//%if multi_context

	async handlePluginExampleEvent(event: PluginExampleEvent) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request: PluginExampleRequest) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
//%endif
//%if controller & web // Subscribing requires web content and the controller

	async handleExampleSubscription(request: lib.SubscriptionRequest) {
		const values = [...this.exampleDatabase.values()].filter(
			value => value.updatedAtMs > request.lastRequestTimeMs,
		);
		return values.length ? new ExampleSubscribableUpdate(values) : null;
	}
//%endif
}
