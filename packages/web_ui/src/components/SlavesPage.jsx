import React, { useContext, useState } from "react";

import libLink from "@clusterio/lib/link";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { copySync } from "fs-extra";

export default function SlavesPage() {
	let control = useContext(ControlContext);
	let table;
	control.live_update_caller = async function(message){
		let item = message.data.item;
		let row = {
			key: item["id"],
			"Name": item["name"],
			"Agent": item["agent"],
			"Version": item["version"],
			"Connected": item["connected"] && "Yes",
		};
		if(table){
			table.add_row(row);
		}
	};
	async function listSlaves() {
		let result = await libLink.messages.listSlaves.send(control);
		result = result["list"].map((item) => ({
			key: item["id"],
			"Name": item["name"],
			"Agent": item["agent"],
			"Version": item["version"],
			"Connected": item["connected"] && "Yes",
		}));
		return result;
	}

	async function save_table_ref(tbl){
		table = tbl;
	}

	return <PageLayout nav={[{ name: "Slaves" }]}>
		<h2>Slaves</h2>
		<DataTable DataFunction={listSlaves} ref={save_table_ref} />
	</PageLayout>;
};
