import { useContext, useEffect, useState } from "react";
import { Table } from "antd";

import {
	BaseWebPlugin, PageLayout, PageHeader, Control, ControlContext, notifyErrorHandler,
	useExportLocale, useExportPrototypeMetadata, useDefaultModPack, FactorioIcon,
	useTableQueryState, useColumnSearch,
} from "@clusterio/web_ui";
import { GetStorageRequest, Item, SetStorageSubscriptionRequest, UpdateStorageEvent } from "../messages";

import "./style.css";


function useStorage(control: Control) {
	let plugin = control.plugins.get("subspace_storage") as WebPlugin;
	let [storage, setStorage] = useState([...plugin.storage]);

	useEffect(() => {
		function update() {
			setStorage([...plugin.storage]);
		}

		plugin.onUpdate(update);
		return () => {
			plugin.offUpdate(update);
		};
	}, []);
	return storage;
}

function StoragePage() {
	let control = useContext(ControlContext);
	const modPack = useDefaultModPack();
	let locale = useExportLocale(modPack);
	const prototypes = useExportPrototypeMetadata(modPack);
	let itemMetadata = prototypes?.get("item");
	let fluidMetadata = prototypes?.get("fluid");
	let storage = useStorage(control);
	const tableState = useTableQueryState<[string, Item]>({
		namespace: "storage", defaultSortKey: "quantity", defaultSortOrder: "descend", pagination: false,
	});
	const resourceSearch = useColumnSearch<[string, Item]>(item => getLocaleName(item[1].name), "Search");

	function getLocaleName(itemName: string) {
		let localeName = itemName;
		let meta = itemMetadata?.get(itemName) ?? fluidMetadata?.get(itemName);
		if (meta && meta.localised_name) {
			// TODO: implement the locale to name conversion.
			if (typeof meta.localised_name === "string") {
				localeName = meta.localised_name;
			} else {
				localeName = locale.get(meta.localised_name[0])!;
			}
		} else {
			for (let section of ["item-name", "entity-name", "fluid-name", "equipment-name"]) {
				let name = locale.get(`${section}.${itemName}`);
				if (name) {
					localeName = name;
					break;
				}
			}
		}

		return localeName;
	}

	let numberFormat = new Intl.NumberFormat("en-US");

	// Build the regex the resource search uses: word-boundary anchored, spaces match any gap.
	function matchesResource(value: string | number | bigint | boolean, item: [string, Item]) {
		let search = String(value).trim();
		if (!search) {
			return true;
		}
		search = search.replace(/(^| )(\w)/g, "$1\\b$2").replace(/ +/g, ".*");
		let filterExpr;
		try {
			filterExpr = new RegExp(search, "i");
		} catch {
			return true;
		}
		return filterExpr.test(getLocaleName(item[1].name)) || filterExpr.test(item[1].name);
	}

	return <PageLayout nav={[{ name: "Storage" }]}>
		<PageHeader title="Storage" />
		<Table
			className="subspace-storage-storage"
			columns={[
				{
					title: "Resource",
					key: "resource",
					...resourceSearch,
					onFilter: matchesResource,
					filteredValue: tableState.filteredValue("resource"),
					sortOrder: tableState.sortOrder("resource"),
					sorter: (a, b) => {
						let aName = getLocaleName(a[1].name);
						let bName = getLocaleName(b[1].name);
						if (aName < bName) { return -1; }
						if (aName > bName) { return 1; }
						return 0;
					},
					render: (_, item) => {
						let localeName = getLocaleName(item[1].name);
						let name = item[1].name;
						const prototype = itemMetadata?.get(name) ?? fluidMetadata?.get(name);

						return <>
							<FactorioIcon modPackId={modPack?.id} prototype={prototype} />
							{localeName}
						</>;
					},
				},
				{
					title: "Quality",
					key: "quality",
					render: (_, item) => item[1].quality,
				},
				{
					title: "Quantity",
					key: "quantity",
					align: "right",
					sorter: (a, b) => a[1].count - b[1].count,
					sortOrder: tableState.sortOrder("quantity"),
					render: (_, item) => numberFormat.format(item[1].count),
				},
			]}
			dataSource={storage}
			rowKey={item => item[0]}
			pagination={tableState.pagination}
			onChange={tableState.onChange}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	storage = new Map<string, Item>();
	callbacks: (() => void)[] = [];

	async init() {
		this.pages = [
			{
				path: "/storage",
				sidebarName: "Storage",
				permission: "subspace_storage.storage.view",
				content: <StoragePage/>,
			},
		];
		this.control.handle(UpdateStorageEvent, this.handleUpdateStorageEvent.bind(this));
	}

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect") {
			this.updateSubscription();
		}
	}

	async handleUpdateStorageEvent(event: UpdateStorageEvent) {
		this.updateStorage(event.items);
	}

	onUpdate(callback: () => void) {
		this.callbacks.push(callback);
		if (this.callbacks.length) {
			this.updateSubscription();
		}
	}

	offUpdate(callback: () => void) {
		let index = this.callbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}

		this.callbacks.splice(index, 1);
		if (!this.callbacks.length) {
			this.updateSubscription();
		}
	}

	updateStorage(items: Item[]) {
		for (let item of items) {
			this.storage.set(`${item.name}:${item.quality}`, item);
		}
		for (let callback of this.callbacks) {
			callback();
		}
	}

	updateSubscription() {
		if (!this.control.connector.connected) {
			return;
		}

		this.control.send(
			new SetStorageSubscriptionRequest(Boolean(this.callbacks.length))
		).catch(notifyErrorHandler("Error subscribing to storage"));

		if (this.callbacks.length) {
			this.control!.send(new GetStorageRequest()).then(
				items => {
					this.updateStorage(items);
				}
			).catch(notifyErrorHandler("Error updating storage"));
		} else {
			this.storage.clear();
		}
	}
}
