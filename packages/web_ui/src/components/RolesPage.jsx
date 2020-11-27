import React, { useContext } from "react";
import { useHistory } from "react-router-dom";

import libLink from "@clusterio/lib/link";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";


export default function UsersPage() {
	let control = useContext(ControlContext);
	let history = useHistory();

	async function listRoles() {
		let result = await libLink.messages.listRoles.send(control);
		return result["list"].map(item => ({
			key: item["id"],
			"Name": item["name"],
			"Description": item["description"],
		}));
	}

	return <PageLayout nav={[{ name: "Roles" }]}>
		<h2>Roles</h2>
		<DataTable
			DataFunction={listRoles}
			AddRecord={{
				fields: [
					{ dataIndex: "name", title: "Name" },
					{ dataIndex: "description", title: "Description" },
				],
				insert: async args => {
					await libLink.messages.createRole.send(control, {
						name: args.name,
						description: args.description || "",
						permissions: [],
					});
				},
			}}
			TableProps={{
				onRow: (record, rowIndex) => ({
					onClick: event => {
						history.push(`/roles/${record.key}/view`);
					},
				}),
			}}
		/>
	</PageLayout>;
}
