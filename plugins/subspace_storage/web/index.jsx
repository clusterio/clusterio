import React, { useContext, useEffect, useState } from "react";
import { Input, Table, Typography } from "antd";

import * as lib from "@clusterio/lib";
import {
	BaseWebPlugin, PageLayout, ControlContext,
	notifyErrorHandler, useItemMetadata, useLocale,
} from "@clusterio/web_ui";
import { GetStorageRequest, SetStorageSubscriptionRequest } from "../dist/plugin/messages";

import "./index.css";

const { Paragraph } = Typography;


function useStorage(control) {
	let plugin = control.plugins.get("subspace_storage");
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
	let locale = useLocale();
	let itemMetadata = useItemMetadata();
	let storage = useStorage(control);
	let [filter, setFilter] = useState(null);

	function getLocaleName(itemName) {
		let localeName = itemName;
		let meta = itemMetadata.get(itemName);
		if (meta && meta.localized_name) {
			// TODO: implement the locale to name conversion.
			localeName = locale.get(meta.localized_name[0]);
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

	return <PageLayout nav={[{ name: "Storage" }]}>
		<h2>Storage</h2>
		<Paragraph>
			<Input
				placeholder="Search"
				onChange={(event) => {
					let search = event.target.value.trim();
					if (!search) {
						setFilter(null);
						return;
					}
					search = search.replace(/(^| )(\w)/g, "$1\\b$2");
					search = search.replace(/ +/g, ".*");
					let filterExpr = new RegExp(search, "i");
					setFilter(() => (item => {
						let name = getLocaleName(item[0]);
						return filterExpr.test(name) || filterExpr.test(item[0]);
					}));
				}}
			/>
		</Paragraph>
		<Table
			columns={[
				{
					title: "Resource",
					key: "resource",
					sorter: (a, b) => {
						let aName = getLocaleName(a[0]);
						let bName = getLocaleName(b[0]);
						if (aName < bName) { return -1; }
						if (aName > bName) { return 1; }
						return 0;
					},
					render: item => {
						let localeName = getLocaleName(item[0]);
						let hasMeta = itemMetadata.get(item[0]);

						return <>
							<span className={`factorio-icon item-${hasMeta ? item[0] : "unknown-item"}`}/>
							{localeName}
						</>;
					},
				},
				{
					title: "Quantity",
					key: "quantity",
					align: "right",
					defaultSortOrder: "descend",
					sorter: (a, b) => a[1] - b[1],
					render: item => numberFormat.format(item[1]),
				},
			]}
			dataSource={filter ? storage.filter(filter) : storage}
			rowKey={item => item[0]}
			pagination={false}
		/>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/storage",
				sidebarName: "Storage",
				permission: "subspace_storage.storage.view",
				content: <StoragePage/>,
			},
		];

		this.storage = new Map();
		this.callbacks = [];
	}

	onControllerConnectionEvent(event) {
		if (event === "connect") {
			this.updateSubscription();
		}
	}

	async updateStorageEventHandler(event) {
		this.updateStorage(event.items);
	}

	onUpdate(callback) {
		this.callbacks.push(callback);
		if (this.callbacks.length) {
			this.updateSubscription();
		}
	}

	offUpdate(callback) {
		let index = this.callbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}

		this.callbacks.splice(index, 1);
		if (!this.callbacks.length) {
			this.updateSubscription();
		}
	}

	updateStorage(items) {
		for (let item of items) {
			this.storage.set(item.name, item.count);
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
			this.control.send(new GetStorageRequest()).then(
				items => {
					this.updateStorage(items);
				}
			).catch(notifyErrorHandler("Error updating storage"));
		} else {
			this.storage.clear();
		}
	}
}
