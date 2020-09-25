import React, { Component } from "react"
import { Card, Table } from "antd"
import { listSlaves, listInstances, listPermissions } from "../../util/wslink"
import DataTable from "../../components/data-table"

export class PermissionsTable extends Component {
    constructor(props) {
        super(props)
    }
    navigate(url) {
      this.props.history.push(url);
    }
    render() {
        return <Card>
            <h2>Permissions</h2>
            <DataTable
                DataFunction={listPermissions}
                TableProps={{
                    onRow: (record, rowIndex) => {
                        return {
                            onClick: event => {
                                this.navigate(`/permissions/${record.id}/view`)
                            }
                        }
                    }
                }}
            />
        </Card>
    }
}
