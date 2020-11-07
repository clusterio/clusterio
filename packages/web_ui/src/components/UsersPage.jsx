import React, { useEffect, useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Spin, Tag } from "antd";

import libLink from "@clusterio/lib/link";

import DataTable from "./data-table";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";


export default function UsersPage() {
	let control = useContext(ControlContext);
	let history = useHistory();

	let [roles, setRoles] = useState(null);

	useEffect(() => {
		libLink.messages.listRoles.send(control).then(result => {
			setRoles(new Map(result["list"].map(role => [role["id"], role])));
		}).catch(() => {
			setRoles(new Map());
		});
	}, []);

	async function listUsers() {
		let result = await libLink.messages.listUsers.send(control);
		return result["list"].map(item => ({
			key: item["name"],
			"Name": item["name"],
			"Roles": item["roles"].map(id => <Tag key={id}>{(roles.get(id) || { name: id })["name"]}</Tag>),
			"Admin": item["is_admin"] && "Yes",
			"Whitelisted": item["is_whitelisted"] && "Yes",
			"Banned": item["is_banned"] && "Yes",
		}));
	}

	// DataTable does not make it possible to update the rendering function
	if (roles === null) {
		return <PageLayout nav={[{ name: "Users" }]}>
			<h2>Users</h2>
			<Spin/>
		</PageLayout>;
	}

	return <PageLayout nav={[{ name: "Users" }]}>
		<h2>Users</h2>
		<DataTable
			DataFunction={listUsers}
			AddRecord={{
				fields: [{
					dataIndex: "name",
					title: "Name",
				}],
				insert: async args => {
					await libLink.messages.createUser.send(control, { name: args.name });
				},
			}}
			TableProps={{
				onRow: (record, rowIndex) => ({
					onClick: event => {
						console.log(record, rowIndex);
						history.push(`/users/${record.key}/view`);
					},
				}),
			}}
		/>
	</PageLayout>;
}
