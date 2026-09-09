import type { IpcPlayerData } from "./messages";

// See packages/host/modules/clusterio/serialize.lua for the item stack format
type SerializedItem = {
	n?: string,
	c?: number,
	q?: string,
	r?: number,
	e?: string,
};

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

export function summarizeInventory(inventory: { i?: SerializedItem[] }): ItemSummary[] {
	let items: ItemSummary[] = [];
	let stacks = new Map<string, ItemSummary>();
	for (let entry of inventory.i ?? []) {
		let repeat = (entry.r ?? 0) + 1;
		if (entry.e !== undefined) {
			for (let i = 0; i < repeat; i++) {
				items.push({ name: "exported item", count: 1, exportSize: entry.e.length });
			}
			continue;
		}
		if (entry.n === undefined) {
			continue;
		}
		let key = `${entry.n}\0${entry.q ?? ""}`;
		let stack = stacks.get(key);
		if (!stack) {
			stack = { name: entry.n, quality: entry.q, count: 0 };
			stacks.set(key, stack);
			items.push(stack);
		}
		stack.count += (entry.c ?? 0) * repeat;
	}
	return items;
}

export function summarizePlayerInventories(playerData: IpcPlayerData): InventorySummary[] {
	let inventories = playerData.character?.inventories ?? playerData.inventories ?? {};
	return Object.entries(inventories).map(
		([name, inventory]) => ({ name, items: summarizeInventory(inventory as { i?: SerializedItem[] }) })
	);
}
