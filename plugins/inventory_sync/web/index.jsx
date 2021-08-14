import React, { useContext, useEffect, useState } from "react";

import libPlugin from "@clusterio/lib/plugin";
import { PageLayout, ControlContext } from "@clusterio/web_ui";
import info from "../info";

import "./index.css";

function InventoryPage() {
	let control = useContext(ControlContext);

	let [statsData, updateStatsData] = useState();

	useEffect(() => {
		(async () => {
			// Get statistics
			updateStatsData(await info.messages.databaseStats.send(control, {}));
		})();
	}, []);

	return <PageLayout nav={[{ name: "Inventory sync" }]}>
		<h2>Inventory sync</h2>
		{statsData && <>
			<p>Database size: {Math.round(statsData.database_size / 1000)}kB</p>
			<p>Database entries: {statsData.database_entries}</p>
			<p>Largest entry is {statsData.largest_entry.name} with {(statsData.largest_entry.size / 1000)}kB</p>
		</>}
	</PageLayout>;
}

export class WebPlugin extends libPlugin.BaseWebPlugin {
	async init() {
		this.pages = [
			{ path: "/inventory", sidebarName: "Inventory sync", content: <InventoryPage /> },
		];
	}

	onMasterConnectionEvent(event) {
		if (event === "connect") {

		}
	}
}
