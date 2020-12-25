import React, { useContext } from "react";
import { useHistory } from "react-router-dom";

import libLink from "@clusterio/lib/link";
import libConfig from "@clusterio/lib/config";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";


export default function InstancesPage() {
	let control = useContext(ControlContext);
	let history = useHistory();

	async function listInstances() {
		let result = await libLink.messages.listInstances.send(control);
		return result["list"].map(item => ({
			key: item["id"],
			"Name": item["name"],
			"Public Address": item["public_address"] + ":" + item["game_port"],
			"Assigned Slave": item["assigned_slave_name"],
			"Assigned Slave ID": item["assigned_slave"],
			"Status": item["status"],
		}));
	}

	return <PageLayout nav={[{ name: "Instances" }]}>
		<h2>Instances</h2>
		<DataTable
			DataFunction={listInstances}
			AddRecord={{
				fields: [{
					dataIndex: "name",
					title: "Name",
				}],
				insert: async args => {
					let instanceConfig = new libConfig.InstanceConfig();
					await instanceConfig.init();
					instanceConfig.set("instance.name", args.name);
					let serialized_config = instanceConfig.serialize();
					let response = await libLink.messages.createInstance.send(control, { serialized_config });
				},
			}}
			TableProps={{
				onRow: (record, rowIndex) => ({
					onClick: event => {
						history.push(`/instances/${record.key}/view`);
					},
				}),
			}}
		/>
	</PageLayout>;
}
