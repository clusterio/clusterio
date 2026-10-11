import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";

import {
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	Item,
} from "./messages.js";

type IpcItems = [name: string, count: number, quality: string][];

export default async function(context: InstancePluginContext) {
	const { instance, host, logger, plugin } = context;
	const pendingTasks = new Set<Promise<unknown>>();
	let pingId: ReturnType<typeof setInterval> | undefined;
	let timeUpdateId: ReturnType<typeof setInterval> | undefined;
	let cachedInventoryItems: Item[] = [];

	function unexpectedError(err: Error) {
		logger.error(`Unexpected error:\n${err.stack}`);
	}

	// provide items --------------------------------------------------------------
	async function provideItems(items: IpcItems) {
		if (!host.connector.hasSession) {
			// For now the items are voided if the controller connection is
			// down, which is no different from the previous behaviour.
			if (instance.config.get("subspace_storage.log_item_transfers")) {
				logger.verbose("Voided the following items:");
				logger.verbose(JSON.stringify(items));
			}
			return;
		}

		const fromIpcItems = items.map(item => new Item(item[0], item[1], item[2]));
		instance.sendTo("controller", new PlaceEvent(fromIpcItems));

		if (instance.config.get("subspace_storage.log_item_transfers")) {
			logger.verbose("Exported the following to controller:");
			logger.verbose(JSON.stringify(items));
		}
	}

	// request items --------------------------------------------------------------
	async function requestItems(orders: IpcItems) {
		logger.info(`Requesting items: ${JSON.stringify(orders)}`);
		// Request the items all at once
		const fromIpcItems = orders.map(item => new Item(item[0], item[1], item[2]));
		let items = await instance.sendTo("controller", new RemoveRequest(fromIpcItems));

		if (!items.length) {
			return;
		}

		if (instance.config.get("subspace_storage.log_item_transfers")) {
			logger.verbose("Imported following from controller:");
			logger.verbose(JSON.stringify(items));
		}

		let itemsJson = lib.escapeString(JSON.stringify(items));
		await instance.sendRcon(`/sc __subspace_storage__ Import("${itemsJson}")`, true, plugin.name);
	}

	instance.server.on("ipc-subspace_storage:output", (output: IpcItems) => {
		logger.info("Received output items:");
		logger.info(JSON.stringify(output));
		provideItems(output).catch(err => unexpectedError(err));
	});
	instance.server.on("ipc-subspace_storage:orders", (orders: IpcItems) => {
		if (instance.status !== "running" || !host.connected) {
			return;
		}

		let task = requestItems(orders).catch(err => unexpectedError(err));
		pendingTasks.add(task);
		task.finally(() => { pendingTasks.delete(task); });
	});

	// combinator signals ---------------------------------------------------------
	instance.handle(UpdateStorageEvent, async (event: UpdateStorageEvent) => {
		if (instance.status !== "running") {
			return;
		}
		// Cache latest inventory from controller
		cachedInventoryItems = event.items;
	});

	instance.hooks.start.attach(plugin.name, async () => {
		pingId = setInterval(() => {
			if (!host.connected) {
				return; // Only ping if we are actually connected to the controller.
			}
			instance.sendRcon(
				"/sc __subspace_storage__ global.ticksSinceMasterPinged = 0", true, plugin.name
			).catch(err => unexpectedError(err));
		}, 5000);

		let items = await instance.sendTo("controller", new GetStorageRequest());

		// Cache items for periodic time updates
		cachedInventoryItems = items;

		// Ensure a payload with updated time is sent every second
		timeUpdateId = setInterval(() => {
			if (instance.status !== "running") {
				return;
			}

			const payloadItems = [
				...cachedInventoryItems,
				new Item("signal-unixtime", Math.floor(Date.now() / 1000), "normal"),
			];
			const payloadJson = lib.escapeString(JSON.stringify(payloadItems));
			const task = instance.sendRcon(
				`/sc __subspace_storage__ UpdateInvData("${payloadJson}")`, true, plugin.name
			).catch(err => unexpectedError(err));
			pendingTasks.add(task);
			task.finally(() => { pendingTasks.delete(task); });
		}, 1000);
	});

	instance.hooks.stop.attach(plugin.name, async () => {
		clearInterval(pingId);
		clearInterval(timeUpdateId);
		await Promise.all(pendingTasks);
	});

	instance.hooks.exit.attach(plugin.name, () => {
		clearInterval(pingId);
		clearInterval(timeUpdateId);
	});
}
