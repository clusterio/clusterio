import React, { Component } from "react"
import { Card, Table } from "antd"
import { listSlaves, listInstances, createInstance } from "../../util/wslink"
import DataTable from "../../components/data-table"
const config = require("../../lib/config")

export class InstancesTable extends Component {
    constructor(props) {
        super(props)
    }
    navigate(url) {
        this.props.history.push(url);
    }
    render() {
        return <Card>
            <h2>Instances</h2>
            <DataTable
                AddRecord={{
                    fields: [{
                        dataIndex: "name",
                        title: "Name"
                    }],
                    insert: async args => {
                        let instanceConfig = new config.InstanceConfig();
                        await instanceConfig.init();
                        console.log("Base config", instanceConfig)
                        instanceConfig.set("instance.name", args.name);
                        let serialized_config = instanceConfig.serialize();
                        let response = await createInstance(serialized_config)
                        console.log("Created instance", response)
                    }
                }}
                DataFunction={listInstances}
                TableProps={{
                    onRow: (record, rowIndex) => {
                        return {
                            onClick: event => {
                                this.navigate(`/instances/${record.id}/view`)
                            }
                        }
                    }
                }}
            />
        </Card>
    }
}
