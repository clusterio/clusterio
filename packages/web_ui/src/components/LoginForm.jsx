import React, { Fragment, useContext } from "react";
import { Button, Card, Divider, Form, Image, Input, List, Space, Spin, Typography } from "antd";
import LockOutlined from "@ant-design/icons/LockOutlined";

import logo from "../images/logo.png";
import PluginsContext from "./PluginsContext";

const { Paragraph, Text } = Typography;


function TokenAuth(props) {
	return <>
		<Paragraph>If you have generated an authentication token from the master server, use that here.</Paragraph>
		<Form
			name="login"
			onFinish={(values) => { props.setToken(values.token); }}
			layout="inline"
		>
			<Form.Item
				name="token"
				rules={[{ required: true }]}
			>
				<Input
					style={{ width: "14em" }}
					prefix=<LockOutlined className="site-form-item-icon" />
					type="password"
					placeholder="Authentication Token"
				/>
			</Form.Item>
			<Button type="primary" htmlType="submit">Log in</Button>
		</Form>
	</>;
}

export default function LoginForm(props) {
	let plugins = useContext(PluginsContext);

	let loginForms = [];
	for (let plugin of plugins.values()) {
		loginForms.push(...plugin.loginForms);
	}

	loginForms.push({
		name: "core.token",
		title: "Token",
		Component: TokenAuth,
	});

	return <Card style={{ maxWidth: "30em" }}>
		<Space style={{ width: "100%" }} direction="vertical" align="center">
			<h1>Clusterio</h1>
			<Image width={128} height={123} src={logo} />
			Log in to the cluster using one of the methods below.
		</Space>
		{loginForms.map(form => <Fragment key={form.name}>
			<Divider orientation="center">{form.title}</Divider>
			<form.Component setToken={props.setToken} />
		</Fragment>)}
	</Card>;
}

