import React, { useContext } from "react";

import libLink from "@clusterio/lib/link";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";


export default function SlavesPage() {
	let control = useContext(ControlContext);

	async function listSlaves() {
		let result = await libLink.messages.listSlaves.send(control);
		return result["list"].map((item) => ({
			key: item["id"],
			"Name": item["name"],
			"Agent": item["agent"],
			"Version": item["version"],
			"Connected": item["connected"] && "Yes",
			"Address": item["public_address"],
		}));
	}

	return <PageLayout nav={[{ name: "Slaves" }]}>
		<h2>Slaves</h2>
		<DataTable DataFunction={listSlaves} />
	</PageLayout>;
};
