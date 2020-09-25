import React, { Component } from "react"
import { Card, Button, Select, Input, Form } from "antd"

const layout = {
    labelCol: {
        span: 4,
    },
    wrapperCol: {
        span: 16,
    },
};
const tailLayout = {
    wrapperCol: {
        offset: 4,
        span: 16,
    },
};

export class Settings extends Component {
    constructor(props) {
        super(props)
        this.state = {
            role: {}
        }
    }
    navigate(url) {
        this.props.history.push(url);
    }
    render() {
        console.log(this.state)
        return <Card>
            <h2>Web interface settings</h2>
            <Form
                {...layout}
                name="basic"
                initialValues={{
                    master_url: localStorage.getItem("master_url"),
                    master_token: localStorage.getItem("master_token"),
                }}
                onFinish={values => {
                    console.log("Saving settings",values)
                    for(let key of Object.keys(values)){
                        localStorage.setItem(key, values[key].replace("https://", "wss://").replace("http://", "ws://"))
                    }
                    // Force refresh to apply changes
                    document.location = document.location
                }}
            >
                <Form.Item
                    label="Master URL"
                    name="master_url"
                    rules={[
                        {
                            required: true,
                            message: 'Please input master url, ex ws://localhost:8080 or wss://localhost:8443/ . For SSL connections, ensure you have a valid certificate.',
                        },
                    ]}
                >
                    <Input />
                </Form.Item>
                <Form.Item
                    label="User auth token"
                    name="master_token"
                    rules={[
                        {
                            required: true,
                            message: 'Please input your user auth token from config-control.json',
                        },
                    ]}
                >
                    <Input />
                </Form.Item>
                <Form.Item {...tailLayout}>
                    <Button type="primary" htmlType="submit">
                        Save
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    }
}
