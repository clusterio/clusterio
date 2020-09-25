import React, { Component } from "react";
import {
    Collapse, Row, Col, Modal, Table,
    Form,
    Input,
    Button,
    Radio,
    Select,
    Cascader,
    DatePicker,
    InputNumber,
    TreeSelect,
    Switch,
    Popover
} from "antd";
import notify from "../util/notify";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";

const { Panel } = Collapse;

/**
 * Display data in table. Allows for editing data by clicking rows in the table.
 * Basic usage: <DataTable Server="SQL08" DataSource="sql" Database="HDG1" Table="[dbo].[ReportInfo]" />
 * 
 * DataFunction - String, corresponds to export from util/wslink. Same as ws message name.
 * columns - Array of objects, optional, same as <Table />. Note the lowercase c
 * Editable - Boolean - Allow editing
 * AddRecord - Boolean - Allow adding new records
 * CustomDataFilterFunction - function(tableData) - Filter tabledata and return results
 * RecordIdField - String - By default we assume the column "Id" is a unique identifier for a record. If that isn't the case, supply the column name here
 */
class DataTable extends Component {
    constructor(props) {
        super(props);
        if (!this.props.DataFunction) throw new Error("DataFunction not defined")
        this.state = {
            pagination: {
                pageSize: 100,
                current: 1
            },
            filters: this.props.Filters,
            sorter: {},
            tableData: [],
            showEditModal: false,
            record: {},
        }
    }
    componentDidMount() {
        this.getData()
    }
    getData = async (pagination, filters, sorter) => {
        /*
            pagination = {
                pageSize: 10, // items per page
                current: 1, // page number
                total: 123, // Total amount of items
            }
            filters = {
                ReportId: 123
            }
            sorter = {}
        */
        pagination = pagination || this.state.pagination
        filters = filters || this.state.filters
        sorter = sorter || this.state.sorter
        // console.log(pagination, filters, sorter)

        let data = await this.props.DataFunction()
        // await fetchApi(this.state.dataUrl, "post", {
        //     database: this.props.Database,
        //     table: this.props.Table,
        //     dataSource: this.props.DataSource,
        //     pagination: this.props.RecordCount? {...pagination, pageSize: this.props.RecordCount, current: 1}:pagination,
        //     filters,
        //     sorter,
        //     recordIdField: this.props.RecordIdField || "Id", // Sort by this
        // })
        console.log(data)
        data = data || {}
        this.setState({
            tableData: this.props.CustomDataFilterFunction ? this.props.CustomDataFilterFunction(data) : data,
            pagination: { ...pagination, ...data.pagination },
            sorter,
            filters,
        })
    }
    showEditModal = (record, index) => {
        if (!this.state.showEditModal)
            this.setState({
                record: record,
                showEditModal: true,
            })
    }
    hideEditModal = () => {
        this.setState({
            showEditModal: false,
            inserting: false,
            record: {}
        })
    }
    onEditFinish = async values => {
        console.log("Finished editing", values)

        if (this.state.inserting) { // Create new record
            var status = {}
            await this.props.AddRecord.insert(values)
        } else { // Edit existing record, capable of doing sparse updates
            var status = {}
            await this.props.Editable.insert(values)
        }
        this.setState({
            showEditModal: false,
            inserting: false,
            record: {},
        })
        // Force refresh of data
        this.getData()
    }
    deleteRecord = async record => {
        delete record.key
        // Delete "null" values as they seem to cause deletes to fail silently when the value is null and field type is float
        for (let key in record) {
            if (record[key] === null) delete record[key]
        }
        var status = {}
        //  await fetchApi(`/api/${this.props.Server}/tableData/record`, "delete", {
        //     database: this.props.Database,
        //     table: this.props.Table,
        //     dataSource: this.props.DataSource,
        //     record,
        // }, undefined, true)

        console.log("Deleted record", status)

        if (status.ok) notify("success", status.msg, "success")
        if (!status.ok) notify("error", status.msg, "error")

        // Force refresh of data
        this.getData()
    }
    render() {
        let tableProps = {
            ...this.props.TableProps || {},
            onRow: (record, rowIndex) => {
                /*
                    To allow for extending functionality, we take a TableProps argument from props and pass it through to the Table component.
                    Since we are also using onRow internaly here, we handle the externally provided events ourselves by passing along the event
                    object. This way the end user isn't affected by our event handlers.
                */
                let externalOnRow = {
                    ...this.props.TableProps?.onRow?.(record, rowIndex),
                }
                return {
                    onClick: event => {
                        if (event.target.type !== "button") {
                            console.log("onRow", record, rowIndex)
                            if (this.props.Editable) this.showEditModal(record, rowIndex)
                            if (externalOnRow.onClick) externalOnRow.onClick(event)
                        }
                    },
                    onDoubleClick: event => {
                        if (externalOnRow.onDoubleClick) externalOnRow.onDoubleClick(event)
                    },
                    onContextMenu: event => {
                        if (externalOnRow.onContextMenu) externalOnRow.onContextMenu(event)
                    },
                    onMouseEnter: event => {
                        if (externalOnRow.onMouseEnter) externalOnRow.onMouseEnter(event)
                    },
                    onMouseLeave: event => {
                        if (externalOnRow.onMouseLeave) externalOnRow.onMouseLeave(event)
                    },
                }
            }
        }
        let columns = this.props.columns || this.inferColumns(this.state.tableData)
        if (this.props.DeleteRecord && !columns.find(x => x.dataIndex === "notInUse")) columns.push({
            // Add delete button on the right
            dataIndex: "notInUse",
            title: "",
            render: (text, record) => <Popover
                content={
                    <Button
                        type="primary"
                        danger
                        onClick={() => {
                            this.deleteRecord(record)
                        }}
                    >
                        Slett permanent
                </Button>
                }
                trigger="click"
            >
                <Button danger style={{ float: "right", fontSize: "16px" }}>
                    <DeleteOutlined />
                </Button>
            </Popover>
        })

        return <>
            <Row>
                <Col span={24}>
                    <style>
                        {`
                            .editableTable .ant-table-tbody > tr {
                                cursor:pointer
                            }
                        `}
                    </style>
                    <Table
                        className={this.props.Editable && "editableTable"}
                        {...tableProps}
                        columns={columns.map(x => {
                            return {
                                ...x, // Add a 4th parameter to the stock render function with all of our table data
                                render: x.render ? (...originalParams) => x.render(...originalParams, this.state.tableData) : undefined
                            }
                        })}
                        dataSource={this.state.tableData}
                        pagination={this.state.pagination.total > 10 ? this.state.pagination : false}
                        onChange={this.getData}
                    />
                    {this.props.AddRecord && <Button type="primary" onClick={() => this.setState({
                        showEditModal: true,
                        inserting: true
                    })}>
                        <PlusOutlined />Add
                    </Button>}
                </Col>
                <Modal
                    visible={this.state.showEditModal}
                    onCancel={this.hideEditModal}
                    footer={null}
                    title={
                        <h2>{this.state.inserting ? "Legg til" : "Rediger"}</h2>
                    }
                >
                    {this.state.showEditModal && <Form
                        labelCol={{
                            span: 6,
                        }}
                        wrapperCol={{
                            span: 12,
                        }}
                        layout="horizontal"
                        onFinish={this.onEditFinish}
                        initialValues={this.state.record}
                    >
                        {

                            (
                                (this.state.inserting && this.props.AddRecord?.fields) // Use externally supplied form input fields
                                || this.props.columns?.filter(x => x.dataIndex !== "notInUse") // Generate input fields from external columns
                                || this.inferColumns(this.state.tableData)).map(col => { // Generate input fields from autogenerated columns (only works with existing data)
                                    console.log(this.state.record)
                                    return <Form.Item key={col.dataIndex} label={col.title} name={col.dataIndex}>
                                        {col.renderEdit?.(this.state.record[col.dataIndex], this.state.record, undefined /* Non spec compliant, is supposed to be index of record */, this.state.tableData) || <Input
                                            placeholder={this.state.record[col.dataIndex]}
                                        />}
                                    </Form.Item>
                                })
                        }
                        <Form.Item>
                            <Button type="primary" htmlType="submit">
                                {this.state.inserting ? "Legg til" : "Lagre"}
                            </Button>
                        </Form.Item>
                    </Form>}
                </Modal>
            </Row>
        </>
    }
    inferColumns = data => {
        // Look at the data and find columns and how to display them. Can be overridden by props.Columns if more customization is needed
        let columns = []
        data.forEach(row => {
            Object.keys(row).filter(x => x !== "key").forEach(key => {
                let existing = columns.find(col => col.key === key)
                if (!existing) {
                    columns.push({
                        key: key,
                        title: key,
                        dataIndex: key,
                    })
                }
            })
        })
        return columns
    }
}

export default DataTable;
