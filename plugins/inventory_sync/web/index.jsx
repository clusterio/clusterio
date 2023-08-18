import React, { useContext, useEffect, useState } from "react";

import * as lib from "@clusterio/lib";
import { PageLayout, ControlContext } from "@clusterio/web_ui";
import { DatabaseStatsRequest } from "../dist/plugin/messages";

import "./index.css";

function InventoryPage() {
	let control = useContext(ControlContext);

	let [statsData, updateStatsData] = useState();

	useEffect(() => {
		(async () => {
			// Get statistics
			updateStatsData(await control.send(new DatabaseStatsRequest()));
		})();
	}, []);

	return <PageLayout nav={[{ name: "Inventory sync" }]}>
		<h2>Inventory sync</h2>
		{statsData && <>
			<p>Database size: {Math.round(statsData.databaseSize / 1000)}kB</p>
			<p>Database entries: {statsData.databaseEntries}</p>
			<p>Largest entry is {statsData.largestEntry.name} with {(statsData.largestEntry.size / 1000)}kB</p>
		</>}
	</PageLayout>;
}

export class WebPlugin extends lib.BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/inventory",
				sidebarName: "Inventory sync",
				permission: "inventory_sync.inventory.view",
				content: <InventoryPage />,
			},
		];
	}

	onControllerConnectionEvent(event) {
		if (event === "connect") {

		}
	}
}
