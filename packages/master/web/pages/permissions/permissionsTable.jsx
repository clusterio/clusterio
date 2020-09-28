import React, { Component } from "react";
import { Card } from "antd";
import { listSlaves, listInstances, listPermissions } from "../../util/wslink";
import DataTable from "../../components/data-table";

export class PermissionsTable extends Component {
	navigate(url) {
		this.props.history.push(url);
	}

	render() {
		return <Card>
			<h2>Permissions</h2>
			<DataTable
				DataFunction={listPermissions}
				TableProps={{
					onRow: (record, rowIndex) => ({
						onClick: event => {
							this.navigate(`/permissions/${record.id}/view`);
						},
					}),
				}}
			/>
		</Card>;
	}
}
