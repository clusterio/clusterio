import React, {useContext} from "react";

import libLink from "@clusterio/lib/link";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";

export default function SlavesPage() {
	let control = useContext(ControlContext);
	let table;
	control.onLiveSlaveAdded("slaves_page", async (message) => {
		let item = message.data.item;
		let row = {
			key: item["id"],
			"Name": item["name"],
			"Agent": item["agent"],
			"Version": item["version"],
			"Connected": item["connected"] && "Yes",
		};
		if (table) {
			table.addRow(row);
		}
	});
	async function listSlaves() {
		let result = await libLink.messages.listSlaves.send(control);
		return result["list"].map((item) => ({
			key: item["id"],
			"Name": item["name"],
			"Agent": item["agent"],
			"Version": item["version"],
			"Connected": item["connected"] && "Yes",
		}));
	}

	async function saveTableRef(tbl) {
		table = tbl;
	}

	return <PageLayout nav={[{ name: "Slaves" }]}>
		<h2>Slaves</h2>
		<DataTable DataFunction={listSlaves} ref={saveTableRef} />
	</PageLayout>;
};
