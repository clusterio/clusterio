import React, { Component } from "react"
import { Card, Table, Button, List, Popover, Select, Divider, Input, Form, Col, Row, Checkbox, Space, Transfer } from "antd"
import {
    listSlaves,
    listInstances,
    startInstance,
    stopInstance,
    setInstanceOutputSubscriptions,
    deleteInstance,
    assignInstance,
    createSave,
    getInstanceConfig,
    setInstanceConfigField,
    sendRcon,
    deleteUser,
    listUsers,
    listRoles,
    setRoles,
    listPermissions,
    updateRole,
} from "../../util/wslink"
import DataTable from "../../components/data-table"
import notify from "../../util/notify"
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"

const { Option } = Select

export class RoleView extends Component {
    constructor(props) {
        super(props)
        this.state = {
            role: {}
        }
    }
    messagesEndRef = React.createRef()
    navigate(url) {
        this.props.history.push(url);
    }
    async componentDidMount() {
        await this.getData()
    }
    getData = async () => {
        let id = this.props.match.params.id

        let roles = await listRoles()
        let permissions = await listPermissions()

        this.setState({
            role: roles.find(x => x.id === Number(id)),
            permissions,
        })
    }
    handleChange = async targetKeys => {
        this.setState({
            role: {
                ...this.state.role,
                permissions: targetKeys
            }
        });
        let response = await updateRole({
            ...this.state.role,
            permissions: targetKeys,
        })
        console.log("Updated user roles", response)
    };
    render() {
        console.log(this.state)
        let { role, permissions } = this.state
        return <Card>
            <Popover
                content={
                    <Button
                        type="primary"
                        danger
                        onClick={async () => {
                            await deleteUser({ role: role.name })
                            notify("Deleted role " + role.name, "success")
                            this.navigate("/roles")
                        }}
                    >
                        Delete this role permanently
            </Button>
                }
                trigger="click"
            >
                <Button danger style={{ float: "right", fontSize: "16px" }}>
                    <DeleteOutlined />
                </Button>
            </Popover>
            <h2>{role.name}</h2>
            <h3>Assign roles</h3>
            <style>
                {`
                .ant-transfer-list{
                    width: calc( 50% - 34px );
                    height: 500px;
                }
                `}
            </style>
            <Transfer
                titles={["Available", "Assigned"]}
                dataSource={permissions}
                showSearch
                filterOption={(inputValue, option) => option.name.toLowerCase().indexOf(inputValue.toLowerCase()) > -1}
                targetKeys={role.permissions}
                onChange={this.handleChange}
                render={item => item.name}
            />
        </Card>
    }
}
