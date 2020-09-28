import React, { Component } from "react";
import { Card } from "antd";
import { listSlaves, listInstances, listRoles, createRole } from "../../util/wslink";
import DataTable from "../../components/data-table";

export class RolesTable extends Component {
	navigate(url) {
		this.props.history.push(url);
	}

	render() {
		return <Card>
			<h2>Roles</h2>
			<DataTable
				AddRecord={{
					fields: [{
						dataIndex: "name",
						title: "Name",
					},{
						dataIndex: "description",
						title: "Description",
					}],
					insert: async args => {
						let response = await createRole({name: args.name, description: args.description});
						console.log("Created role",response);
					},
				}}
				DataFunction={listRoles}
				TableProps={{
					onRow: (record, rowIndex) => ({
						onClick: event => {
							this.navigate(`/roles/${record.id}/view`);
						},
					}),
				}}
			/>
		</Card>;
	}
}
