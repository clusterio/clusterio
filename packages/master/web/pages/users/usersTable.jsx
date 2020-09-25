import React, { Component } from "react"
import { Card, Table } from "antd"
import { listSlaves, listInstances, listUsers, createUser } from "../../util/wslink"
import DataTable from "../../components/data-table"

export class UsersTable extends Component {
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
                AddRecord={{
                    fields: [{
                        dataIndex: "name",
                        title: "Name"
                    }],
                    insert: async args => {
                        let response = await createUser({name: args.name})
                        console.log("Created user",response)
                    }
                }}
                DataFunction={listUsers}
                TableProps={{
                    onRow: (record, rowIndex) => {
                        return {
                            onClick: event => {
                                this.navigate(`/users/${record.name}/view`)
                            }
                        }
                    }
                }}
            />
        </Card>
    }
}
