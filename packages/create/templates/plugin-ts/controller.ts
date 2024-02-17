import * as lib from "@clusterio/lib";
import { BaseControllerPlugin, InstanceInfo } from "@clusterio/controller";
import { PluginExampleEvent, PluginExampleRequest,/*/ [subscribable] /*/ ExampleSubscribableUpdate, ExampleSubscribableValue/*/ [] /*/ } from "./messages";

export class ControllerPlugin extends BaseControllerPlugin {// [subscribable] //
	exampleDatabase!: Map<string, ExampleSubscribableValue>;
	storageDirty = false;
	// [] //
	async init() {
		this.controller.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.controller.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));// [subscribable] //
		this.controller.subscriptions.handle(ExampleSubscribableUpdate, this.handleExampleSubscription.bind(this));
		this.exampleDatabase = new Map();// [] //
	}

	async onControllerConfigFieldChanged(field: string, curr: unknown, prev: unknown) {
		this.logger.info(`controller::onControllerConfigFieldChanged ${field}`);
	}// [instance] //

	async onInstanceConfigFieldChanged(instance: InstanceInfo, field: string, curr: unknown, prev: unknown) {
		this.logger.info(`controller::onInstanceConfigFieldChanged ${instance.id} ${field}`);
	}// [] //

	async onSaveData() {
		this.logger.info("controller::onSaveData");
	}

	async onShutdown() {
		this.logger.info("controller::onShutdown");
	}

	async onPlayerEvent(instance: InstanceInfo, event: lib.PlayerEvent) {
		this.logger.info(`controller::onPlayerEvent ${instance.id} ${JSON.stringify(event)}`);
	}

	async handlePluginExampleEvent(event: PluginExampleEvent) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request: PluginExampleRequest) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}// [subscribable] //

	async handleExampleSubscription(request: lib.SubscriptionRequest) {
		const values = [...this.exampleDatabase.values()].filter(
			value => value.updatedAtMs > request.lastRequestTimeMs,
		);
		return values.length ? new ExampleSubscribableUpdate(values) : null;
	}// [] //
}
