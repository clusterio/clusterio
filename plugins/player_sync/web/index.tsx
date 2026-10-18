import React, { useContext, useEffect, useState } from "react";

import { PageLayout, PageHeader, ControlContext, type WebPluginContext } from "@clusterio/web_ui";
import { DatabaseStatsRequest, DatabaseStatsResponse } from "../messages.js";

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

	return <PageLayout nav={[{ name: "Player sync" }]}>
		<PageHeader title="Player sync" />
		{statsData && <>
			<p>Database size: {Math.round(statsData.databaseSize / 1000)}kB</p>
			<p>Database entries: {statsData.databaseEntries}</p>
			<p>Largest entry is {statsData.largestEntry.name} with {(statsData.largestEntry.size / 1000)}kB</p>
		</>}
	</PageLayout>;
}

export default async function(context: WebPluginContext) {
	const { control, plugin } = context;

	control.hooks.pages.attach(plugin.name, () => [
		{
			path: "/inventory",
			sidebarName: "Player sync",
			permission: "player_sync.inventory.view",
			content: <InventoryPage />,
		},
	]);
}
