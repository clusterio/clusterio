import React, { Component } from "react"
import { Card, Table, Button, List, Popover, Select, Divider, Input, Form, Col, Row, Checkbox, Space } from "antd"
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
} from "../../util/wslink"
import DataTable from "../../components/data-table"
import notify from "../../util/notify"
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"

const { Option } = Select

export class InstanceView extends Component {
    constructor(props) {
        super(props)
        this.state = {
            instance: {},
            slaves: [],
            logLines: [{ message: "Logviewer. Follows the latest logs if you scroll to the bottom. Does not store logs past the lifetime of this tab" }],
        }
    }
    messagesEndRef = React.createRef()
    navigate(url) {
        this.props.history.push(url);
    }
    async componentDidMount() {
        let id = this.props.match.params.id

        await this.getData()

        await setInstanceOutputSubscriptions({
            instance_id: Number(id),
        })
        window.instanceOutputEventHandler = ({ instance_id, output }) => {
            if (instance_id === Number(id)) {
                this.setState({
                    logLines: [...this.state.logLines, output],
                })
            }
            // Automatically scroll to bottom on new line.
            // this.messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }
    getData = async () => {
        let id = this.props.match.params.id

        let instances = await listInstances()
        let slaves = await listSlaves()

        this.setState({
            instance: instances.find(x => x.id === Number(id)),
            slaves,
        })

        let config = await getInstanceConfig({ instance_id: Number(id) })
        console.log(config)
        this.setState({
            config
        })
    }
    start = async () => {
        this.setState({
            starting: true,
        })
        try {
            await startInstance({
                instance_id: this.state.instance.id,
                save: null,
            })
        } catch (e) {
            notify("Error starting instance", "error", e.message)
            return this.setState({
                starting: false,
            })
        }
        notify("Instance started")
        this.setState({
            starting: false,
        })
        this.getData()
    }
    stop = async () => {
        this.setState({
            stopping: true,
        })
        try {
            await stopInstance({
                instance_id: this.state.instance.id,
            })
        } catch (e) {
            notify("Error stopping instance", "error", e.message)
            return this.setState({
                stopping: false,
            })
        }
        notify("Instance stopped")
        this.setState({
            stopping: false,
        })
        this.getData()
    }
    createSave = async () => {
        this.setState({
            creatingSave: true,
        })
        try {
            await createSave({
                instance_id: this.state.instance.id,
            })
        } catch (e) {
            notify("Error creating save", "error", e.message)
            return this.setState({
                creatingSave: false,
            })
        }
        notify("Save created", "success")
        this.setState({
            creatingSave: false,
        })
    }
    onConfigEditFinish = async values => {
        console.log("Completed config edit with", values)
        for (let k in values) {
            if (values[k] !== this.getInstanceConfigAsKvObject(this.state.config)[k]) {
                let value = values[k]
                if (typeof value === "boolean") value = value.toString()
                console.log("Setting", k, value)
                await setInstanceConfigField({
                    instance_id: this.state.instance.id,
                    field: k,
                    value: value,
                })
            }
        }
        notify("Set configuration fields", "success")
        this.setState({
            editingConfig: false
        })
        this.getData()
    }
    render() {
        console.log(this.state)
        let { instance, slaves } = this.state
        return <Card>
            <h2>{instance.name}</h2>
            <p>ID: {instance.id}</p>
            <p>Slave: {slaves?.find(x => x.id === instance.assigned_slave)?.name}</p>
            {instance.status !== "running" && <Button
                loading={this.state.starting}
                type="primary"
                onClick={this.start}
            >
                Start server
            </Button>}
            {instance.status !== "stopped" && <Button
                loading={this.state.stopping}
                type="primary"
                onClick={this.stop}
            >
                Stop server
            </Button>}
            {instance.status !== "running" && <Button
                loading={this.state.creatingSave}
                type="primary"
                onClick={this.createSave}
            >
                Create save
            </Button>}
            <Popover
                content={
                    <Select style={{
                        width: "200px"
                    }}
                        onChange={async newSlaveId => {
                            let result = await assignInstance({ instance_id: instance.id, slave_id: newSlaveId })
                            notify("Assigned to slave", "success")
                            this.getData()
                        }}
                    >
                        {this.state.slaves.map(slave => <Option defaultValue={instance.assigned_slave} value={slave.id} key={slave.id}>
                            {slave.name}
                        </Option>)}
                    </Select>
                }
                trigger="click"
                type={instance.status === "unassigned" ? "primary" : "default"}
            >
                <Button>
                    Assign to slave
                </Button>
            </Popover>
            <Popover
                content={
                    <Button
                        type="primary"
                        danger
                        onClick={async () => {
                            await deleteInstance({ instance_id: instance.id });
                            notify("Deleted instance " + instance.id, "success")
                            this.navigate("/instances")
                        }}
                    >
                        Delete this instance permanently
                </Button>
                }
                trigger="click"
            >
                <Button danger style={{ float: "right", fontSize: "16px" }}>
                    <DeleteOutlined />
                </Button>
            </Popover>
            <style>
                {/* Scroll sticks to bottom of terminal window after manually scrolling to the bottom */}
                {`#scroller * {
                    /* don't allow the children of the scrollable element to be selected as an anchor node */
                    overflow-anchor: none;
                }
                #anchor {
                    /* allow the final child to be selected as an anchor node */
                    overflow-anchor: auto;

                    /* anchor nodes are required to have non-zero area */
                    height: 1px;
                }`}
            </style>
            <div id="scroller" style={{
                height: "300px",
                overflowY: "scroll",
            }}>
                {this.state.logLines.map(item => <p>{item.time} {item.level} {item.file}: {item.message}</p>)}
                <div id="anchor" ref={this.messagesEndRef}></div>
            </div>
            {/* rcon input field */}
            <Form
                onFinish={async values => {
                    await sendRcon({ instance_id: instance.id, command: values.command })
                }}
            >
                <Form.Item
                    label="RCON: "
                    name="command"
                >
                    <Input />
                </Form.Item>
            </Form>
            {this.state.config && this.renderConfig(this.state.config)}
        </Card>
    }
    getInstanceConfigAsKvObject(config) {
        let object = {}
        for (let group of config.serialized_config.groups) {
            for (let fieldName in group.fields) {
                object[group.name + "." + fieldName] = group.fields[fieldName]
            }
        }
        return object
    }
    renderConfig(config) {
        const layout = {
            labelCol: {
                span: 6,
            },
            wrapperCol: {
                span: 14,
            },
        };
        const tailLayout = {
            wrapperCol: {
                offset: 6,
                span: 14,
            },
        };
        return <Card>
            <Form
                {...layout}
                initialValues={this.getInstanceConfigAsKvObject(config)}
                onFinish={this.onConfigEditFinish}
            >
                {this.state.editingConfig ?
                    <Form.Item>
                        <Button type="primary" htmlType="submit">
                            Save config changes
                        </Button>
                    </Form.Item>
                    :
                    <Button onClick={() => this.setState({ editingConfig: true })}>
                        <EditOutlined /> Edit config
                    </Button>
                }
                <Row>
                    {config && config.serialized_config.groups.map(group => <>
                        <Col span={24} lg={12}>
                            <Divider
                            // orientation="left"
                            >{group.name}</Divider>
                            {/* {Object.keys(group.fields).map(field => <>
                                <span>{field}: </span>
                                <span>{JSON.stringify(group.fields[field])}</span>
                                <br />
                            </>)} */}
                            {console.log(group)}
                            {Object.keys(group.fields).map(field => <ConfigFormItem field={field} group={group} editingConfig={this.state.editingConfig} />)}
                        </Col>
                    </>)}
                </Row>
            </Form>
        </Card>
    }
}

function renderDisplayField(value) {
    if (typeof value === "object") {
        return JSON.stringify(value)
    }
    if (typeof value === "boolean") {
        return <Checkbox />
    }
    return value.toString()
}
function renderFormField(value) {
    if (typeof value === "object") {
        return <ObjectInput />
    }
    if (typeof value === "boolean") {
        return <Checkbox />
    }
    return <Input />
}

class ObjectInput extends Component {
    constructor(props) {
        super(props)
        console.log(this.props)
        /*
            value: {
                auto_pause: false,
                tags: ["clusterio"]
            },
            id: "factorio.settings",
            onChange: f()
        */
        this.state = {}
    }
    onChange(e, key) {
        if (e.target.type === "checkbox") {
            // if (e.target.checked !== undefined) {
            // Its a checkbox, set value to true/false
            let value = { ...this.props.value }
            value[key] = e.target.checked || false
            this.props.onChange(value)
        } else if (e.target.type === "text") {
            // } else if (e.target.value !== undefined) {
            // its probably a text input
            let value = { ...this.props.value }
            value[key] = e.target.value || ""
            this.props.onChange(value)
        }
    }
    render() {
        let { value } = this.props
        let ret = []
        for (let key in value) {
            if (typeof value[key] === "boolean") {
                ret.push(<Checkbox
                    key={key}
                    checked={value[key]}
                    onChange={e => this.onChange(e, key)}
                >
                    {key}
                </Checkbox>
                )
            } else if (typeof value[key] === "string") {
                ret.push(<div
                    key={key}
                ><span>{key}</span><Input
                        value={value[key]}
                        onChange={e => this.onChange(e, key)}
                    /></div>
                )
            }
        }
        ret.push(<Popover
            key="addMore"
            content={<>
                <Input onChange={e => this.setState({ newInput: e.target.value })} />
                <Button
                    onClick={e => {
                        this.onChange({ target: { value: "", type: "text" } }, this.state.newInput)
                        this.setState({
                            newInput: undefined,
                            addPopoverVisible: false,
                        })
                    }}
                ><PlusOutlined />Add property</Button>
            </>}
            trigger="click"
            visible={this.state.addPopoverVisible}
            handleVisibleChange={visible => this.setState({ addPopoverVisible: visible })}
        >
            <Button
                onClick={e => this.setState({ addPopoverVisible: true })}
            >
                <PlusOutlined />Add property
            </Button>
        </Popover>)
        return <Space direction="vertical">{ret}</Space>
    }
}
class ConfigFormItem extends Component {
    constructor(props) {
        super(props)
    }
    render() {
        let { field, group, editingConfig } = this.props
        return <Form.Item
            label={field}
            name={group.name + "." + field}
            valuePropName={typeof group.fields[field] === "boolean" ? "checked" : "value" /* Boolean fields should be rendered as checkboxes */}
        >
            {editingConfig ?
                renderFormField(group.fields[field])
                :
                renderDisplayField(group.fields[field])
            }
        </Form.Item>
    }
}
