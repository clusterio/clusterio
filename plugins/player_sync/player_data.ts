import type { IpcPlayerData } from "./messages.js";

// See packages/host/modules/clusterio/serialize.lua for the item stack format
type SerializedItem = {
	n?: string,
	c?: number,
	q?: string,
	r?: number,
	e?: string,
};

// Factorio serializes an empty table as {}
type SerializedInventory = { i?: SerializedItem[] | Record<string, SerializedItem> };

export type ItemSummary = {
	name: string,
	quality?: string,
	count: number,
	/** Length of the export string for blueprints and other exportable items */
	exportSize?: number,
};

export type InventorySummary = {
	name: string,
	items: ItemSummary[],
};

export function summarizeInventory(inventory: SerializedInventory): ItemSummary[] {
	let items: ItemSummary[] = [];
	let stacks = new Map<string, ItemSummary>();
	for (let entry of Object.values(inventory?.i ?? [])) {
		// Uploads are not validated as strictly as imports
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		let repeat = Number.isInteger(entry.r) ? entry.r! + 1 : 1;
		if (typeof entry.e === "string") {
			items.push({ name: "exported item", count: repeat, exportSize: entry.e.length });
			continue;
		}
		if (typeof entry.n !== "string") {
			continue;
		}
		let key = `${entry.n}\0${entry.q ?? ""}`;
		let stack = stacks.get(key);
		if (!stack) {
			stack = { name: entry.n, quality: entry.q, count: 0 };
			stacks.set(key, stack);
			items.push(stack);
		}
		stack.count += (typeof entry.c === "number" ? entry.c : 0) * repeat;
	}
	return items;
}

export function summarizePlayerInventories(playerData: IpcPlayerData): InventorySummary[] {
	let inventories = playerData.character?.inventories ?? playerData.inventories ?? {};
	return Object.entries(inventories).map(
		([name, inventory]) => ({ name, items: summarizeInventory(inventory as SerializedInventory) })
	);
}
