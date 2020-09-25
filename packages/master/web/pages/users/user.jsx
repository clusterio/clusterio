import React, { Component } from "react"
import { Card, Button, Popover, Select, Transfer } from "antd";
import {
    deleteUser,
    listUsers,
    listRoles,
    setRoles,
} from "../../util/wslink"
import DataTable from "../../components/data-table"
import notify from "../../util/notify"
import DeleteOutlined from "@ant-design/icons/DeleteOutlined"

const { Option } = Select

export class UserView extends Component {
    constructor(props) {
        super(props)
        this.state = {
            user: {}
        }
        this.messagesEndRef = React.createRef();
    }
    navigate(url) {
        this.props.history.push(url);
    }
    async componentDidMount() {
        await this.getData()
    }
    async getData() {
        let name = this.props.match.params.id

        let users = await listUsers()
        let roles = await listRoles()

        this.setState({
            user: users.find(x => x.name === name),
            roles,
        })
    }
    async handleChange(targetKeys) {
        this.setState({
            user: {
                ...this.state.user,
                roles: targetKeys
            }
        });
        let response = await setRoles({
            name: this.state.user.name,
            roles: targetKeys,
        })
        console.log("Updated user roles",response)
    };
    render() {
        console.log(this.state)
        let { user, roles } = this.state
        return <Card>
            <h2>{user.name}</h2>
            <h3>Assign roles</h3>
            <Transfer
            titles={["Available","Assigned"]}
                dataSource={roles}
                showSearch
                filterOption={(inputValue, option) => option.name.toLowerCase().indexOf(inputValue.toLowerCase()) > -1}
                targetKeys={user.roles}
                onChange={this.handleChange.bind(this)}
                render={item => item.name}
            />
            <Popover
                content={
                    <Button
                        type="primary"
                        danger
                        onClick={async () => {
                            await deleteUser({ name: user.name })
                            notify("Deleted user " + user.name, "success")
                            this.navigate("/users")
                        }}
                    >
                        Delete this user from the cluster
                </Button>
                }
                trigger="click"
            >
                <Button danger style={{ float: "right", fontSize: "16px" }}>
                    <DeleteOutlined />
                </Button>
            </Popover>
        </Card>
    }
}
