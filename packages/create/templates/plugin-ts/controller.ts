import * as lib from "@clusterio/lib";
import type { ControllerPluginContext, InstanceRecord } from "@clusterio/controller";
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

export default async function loadControllerPlugin(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
//%if controller & web // Subscribing requires web content and the controller
	// If needed, replace with loading from database file such as lib.Datastore
	const exampleDatabase = new Map([["foo", new ExampleSubscribableValue("foo", 0, false)]]);
//%endif
//%if multi_context // Messages requires multi context

	controller.handle(PluginExampleEvent, async (event: PluginExampleEvent) => {
		logger.info(JSON.stringify(event));
	});

	controller.handle(PluginExampleRequest, async (request: PluginExampleRequest) => {
		logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	});
//%endif
//%if controller & web // Subscribing requires web content and the controller

	controller.subscriptions.handle(ExampleSubscribableUpdate, async (request: lib.SubscriptionRequest) => {
		logger.info(JSON.stringify(request));
		const values = [...exampleDatabase.values()].filter(
			value => value.updatedAtMs > request.lastRequestTimeMs,
		);
		return values.length ? new ExampleSubscribableUpdate(values) : null;
	});
//%endif

	controller.hooks.controllerConfigFieldChanged.attach(plugin.name, async (field, curr, prev) => {
		logger.info(`controller::controllerConfigFieldChanged ${field}`);
	});
//%if instance

	controller.hooks.instanceConfigFieldChanged.attach(
		plugin.name, async (instance: InstanceRecord, field, curr, prev) => {
			logger.info(`controller::instanceConfigFieldChanged ${instance.id} ${field}`);
		}
	);
//%endif

	controller.hooks.save.attach(plugin.name, async () => {
		logger.info("controller::save");
	});

	controller.hooks.shutdown.attach(plugin.name, async () => {
		logger.info("controller::shutdown");
	});

	controller.hooks.playerEvent.attach(plugin.name, async (instance: InstanceRecord, event: lib.PlayerEvent) => {
		logger.info(`controller::playerEvent ${instance.id} ${JSON.stringify(event)}`);
	});
}
