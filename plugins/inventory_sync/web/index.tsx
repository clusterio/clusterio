import React, { useContext, useEffect, useState } from "react";

import { BaseWebPlugin, PageLayout, ControlContext } from "@clusterio/web_ui";
import { DatabaseStatsRequest, DatabaseStatsResponse } from "../messages";

import "./style.css";

function InventoryPage() {
	let control = useContext(ControlContext);

	let [statsData, updateStatsData] = useState<DatabaseStatsResponse>();

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

export class WebPlugin extends BaseWebPlugin {
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
}
