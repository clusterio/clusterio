import type { ControlConnection, ControllerPluginContext } from "@clusterio/controller";

import fs from "node:fs/promises";
import path from "path";

import * as lib from "@clusterio/lib";
import { Counter, Gauge } from "@clusterio/lib";

import * as routes from "./routes.js";
import * as dole from "./dole.js";

import {
	Item,
	PlaceEvent,
	RemoveRequest,
	GetStorageRequest,
	UpdateStorageEvent,
	SetStorageSubscriptionRequest,
} from "./messages.js";


const exportCounter = new Counter(
	"clusterio_subspace_storage_export_total",
	"Resources exported by instance",
	{ labels: ["instance_id", "resource", "quality"] }
);
const importCounter = new Counter(
	"clusterio_subspace_storage_import_total",
	"Resources imported by instance",
	{ labels: ["instance_id", "resource", "quality"] }
);
const controllerInventoryGauge = new Gauge(
	"clusterio_subspace_storage_controller_inventory",
	"Amount of resources stored on controller",
	{ labels: ["resource", "quality"] }
);


async function loadDatabase(
	config: lib.ControllerConfig,
	logger: lib.Logger
): Promise<lib.ItemDatabase> {
	let itemsPath = path.resolve(config.get("controller.database_directory"), "items.json");
	logger.verbose(`Loading ${itemsPath}`);
	try {
		let content = await fs.readFile(itemsPath, { encoding: "utf8" });
		return new lib.ItemDatabase(JSON.parse(content));

	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new item database");
			return new lib.ItemDatabase();
		}
		throw err;
	}
}

async function saveDatabase(
	controllerConfig: lib.ControllerConfig,
	items: lib.ItemDatabase | undefined,
	logger: lib.Logger,
) {
	if (items && items.size < 50000) {
		let file = path.resolve(controllerConfig.get("controller.database_directory"), "items.json");
		logger.verbose(`writing ${file}`);
		let content = JSON.stringify(items.serialize());
		await lib.safeOutputFile(file, content);
	} else if (items) {
		logger.error(`Item database too large, not saving (${items.size})`);
	}
}

export default async function(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;

	const items = await loadDatabase(controller.config, logger);
	let storageDirty = false;
	let itemsLastUpdate = new Map<string, lib.ItemCountWithQuality>();
	for (const [name, qualities] of items.getEntries()) {
		itemsLastUpdate.set(name, { ...qualities });
	}
	const subscribedControlLinks = new Set<ControlConnection>();

	function broadcastStorage() {
		let itemsToUpdate: Item[] = [];
		for (const [name, qualities] of items.getEntries()) {
			const lastQualities = itemsLastUpdate.get(name);
			for (const [quality, count] of Object.entries(qualities)) {
				if (!lastQualities || lastQualities[quality] !== count) {
					itemsToUpdate.push(new Item(name, count, quality));
				}
			}
		}

		if (!itemsToUpdate.length) {
			return;
		}

		let update = new UpdateStorageEvent(itemsToUpdate);
		controller.sendTo("allInstances", update);
		for (let link of subscribedControlLinks) {
			link.send(update);
		}

		itemsLastUpdate = new Map();
		for (const [name, qualities] of items.getEntries()) {
			itemsLastUpdate.set(name, { ...qualities });
		}
	}

	const itemUpdateRateLimiter = new lib.RateLimiter({
		maxRate: 1,
		action: () => {
			try {
				broadcastStorage();
			} catch (err: any) {
				logger.error(`Unexpected error sending storage update:\n${err.stack}`);
			}
		},
	});

	function updateStorage() {
		itemUpdateRateLimiter.activate();
		storageDirty = true;
	}

	const neuralDole = new dole.NeuralDole({ items });
	const doleMagicId = setInterval(() => {
		if (controller.config.get("subspace_storage.division_method") === "neural_dole") {
			neuralDole.doMagic();
		}
	}, 1000);

	routes.addApiRoutes(controller.app, items);

	controller.handle(GetStorageRequest, async () => {
		const result: Item[] = [];
		for (const [name, qualities] of items.getEntries()) {
			for (const [quality, count] of Object.entries(qualities)) {
				result.push(new Item(name, count, quality));
			}
		}
		return result;
	});

	controller.handle(PlaceEvent, async (request: PlaceEvent, src: lib.Address) => {
		let instanceId = src.id;

		for (let item of request.items) {
			items.addItem(item.name, item.count, item.quality || "normal");
			exportCounter.labels(String(instanceId), item.name, item.quality || "normal").inc(item.count);
		}

		updateStorage();

		if (controller.config.get("subspace_storage.log_item_transfers")) {
			logger.verbose(
				`Imported the following from ${instanceId}:\n${JSON.stringify(request.items)}`
			);
		}
	});

	controller.handle(RemoveRequest, async (request: RemoveRequest, src: lib.Address) => {
		let method = controller.config.get("subspace_storage.division_method");
		let instanceId = src.id;

		let itemsRemoved = [];
		if (method === "simple") {
			for (let item of request.items) {
				const quality = item.quality || "normal";
				let count = items.getItemCount(item.name, quality);
				let toRemove = Math.min(count, item.count);
				if (toRemove > 0) {
					items.removeItem(item.name, toRemove, quality);
					itemsRemoved.push(new Item(item.name, toRemove, quality));
				}
			}
		} else {
			let instance = controller.instances.get(instanceId);
			let instanceName = instance ? instance.config.get("instance.name") : "unknown";

			// use fancy neural net to calculate a "fair" dole division rate.
			if (method === "neural_dole") {
				for (let item of request.items) {
					const quality = item.quality || "normal";
					let count = neuralDole.divider(
						{ name: item.name, quality, count: item.count, instanceId, instanceName }
					);
					if (count > 0) {
						itemsRemoved.push(new Item(item.name, count, quality));
					}
				}

			// Use dole division. Makes it really slow to drain out the last little bit.
			} else if (method === "dole") {
				for (let item of request.items) {
					const quality = item.quality || "normal";
					let count = dole.doleDivider({
						object: { name: item.name, quality, count: item.count, instanceId, instanceName },
						items,
						logItemTransfers: controller.config.get("subspace_storage.log_item_transfers"),
						logger,
					});
					if (count > 0) {
						itemsRemoved.push(new Item(item.name, count, quality));
					}
				}

			// Should not be possible
			} else {
				throw Error(`Unknown division_method ${method}`);
			}
		}

		if (itemsRemoved.length) {
			for (let item of itemsRemoved) {
				importCounter.labels(String(instanceId), item.name, item.quality || "normal").inc(item.count);
			}

			updateStorage();

			if (itemsRemoved.length && controller.config.get("subspace_storage.log_item_transfers")) {
				logger.verbose(`Exported the following to ${instanceId}:\n${JSON.stringify(itemsRemoved)}`);
			}
		}

		return itemsRemoved;
	});

	controller.handle(SetStorageSubscriptionRequest, async (
		request: SetStorageSubscriptionRequest,
		src: lib.Address,
	) => {
		let link = controller.wsServer.controlConnections.get(src.id)!;
		if (request.storage) {
			subscribedControlLinks.add(link);
		} else {
			subscribedControlLinks.delete(link);
		}
	});

	controller.hooks.controlConnectionEvent.attach(plugin.name, (connection, event) => {
		if (event === "close") {
			subscribedControlLinks.delete(connection);
		}
	});

	controller.hooks.metrics.attach(plugin.name, async () => {
		for (const [name, qualities] of items.getEntries()) {
			for (const [quality, count] of Object.entries(qualities)) {
				controllerInventoryGauge.labels(name, quality).set(Number(count) || 0);
			}
		}
	});

	controller.hooks.shutdown.attach(plugin.name, async () => {
		itemUpdateRateLimiter.cancel();
		clearInterval(doleMagicId);
	});

	controller.hooks.save.attach(plugin.name, async () => {
		if (storageDirty) {
			storageDirty = false;
			await saveDatabase(controller.config, items, logger);
		}
	});
}
