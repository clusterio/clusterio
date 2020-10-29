import React from "react";
import { Form, Input, Button } from "antd";
import LockOutlined from "@ant-design/icons/LockOutlined";

export default function LoginForm(props) {
	return (
		<Form
			name="login"
			onFinish={(values) => { props.setToken(values.token); }}
		>
			<Form.Item
				name="token"
				rules={[
					{ required: true, message: "Please input authentication token" },
				]}
			>
				<Input
					prefix={<LockOutlined className="site-form-item-icon" />}
					type="password"
					placeholder="Authentication Token"
				/>
			</Form.Item>
			<Button type="primary" htmlType="submit">Log in</Button>
		</Form>
	);
}

