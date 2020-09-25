import React, { Component } from "react"
import { Card, Table } from "antd"
import { listSlaves, listInstances } from "../../util/wslink"
import DataTable from "../../components/data-table"

export class SlavesTable extends Component {
    constructor(props) {
        super(props)
    }
    navigate(url) {
      this.props.history.push(url);
    }
    render() {
        return <Card>
            <h2>Slaves</h2>
            <DataTable
                DataFunction={listSlaves}
                TableProps={{
                    onRow: (record, rowIndex) => {
                        return {
                            onClick: event => {
                                this.navigate(`/slaves/${record.id}/view`)
                            }
                        }
                    }
                }}
            />
        </Card>
    }
}
