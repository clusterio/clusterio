import React, { useEffect, useState } from "react";

import libPlugin from "@clusterio/lib/plugin";
import { notify, notifyErrorHandler } from "@clusterio/web_ui";
import { Button, Form, Input, Spin, Typography } from "antd";

import "./index.css";

const { Paragraph, Text } = Typography;


function LoginForm(props) {
	let [servers, setServers] = useState(null);
	let [playerCode, setPlayerCode] = useState(null);
	let [playerCodeError, setPlayerCodeError] = useState(null);
	let [verifyCode, setVerifyCode] = useState(null);
	let [verifyToken, setVerifyToken] = useState(null);

	useEffect(() => {
		(async () => {
			let response = await fetch(`${webRoot}api/player_auth/servers`);
			if (response.ok) {
				setServers(await response.json());
			} else {
				setServers([]);
			}
		})();
	}, []);

	useEffect(() => {
		if (verifyToken) {
			let checkLoop = setInterval(() => {
				(async () => {
					let response = await fetch(`${webRoot}api/player_auth/verify`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							verify_token: verifyToken,
							verify_code: verifyCode,
							player_code: playerCode,
						}),
					});
					if (!response.ok) {
						throw new Error(`Bad server response: ${response.status}`);
					}
					let json = await response.json();
					if (json.error) {
						// While there are other possibilites the most likely
						// cause of an error response here is that the code expired.
						setPlayerCodeError("Code expired");
						setVerifyToken(null);
						clearInterval(checkLoop);
						return;
					}
					if (json.verified) {
						props.setToken(json.token);
					}
				})().catch(err => {
					clearInterval(checkLoop);
					notifyErrorHandler("Error verifying code")(err);
				});
			}, 2000);
			return () => { clearInterval(checkLoop); };
		}

		return undefined;
	}, [verifyToken]);

	if (!servers) {
		return <Spin size="large" />;
	}

	if (servers.length === 0) {
		return <Paragraph>
			There are no servers in the cluster currently running that can complete
			the login via Factorio.  Please try again later.
		</Paragraph>;
	}

	return <>
		<Paragraph>Login using your Factorio account is a 3 step process:</Paragraph>
		<style>
		</style>
		<ol className="factorio-login-steps">
			<li>
				<Paragraph>
					Start Factorio, join one of the following multiplayer servers
					and type <Text keyboard>/web-login</Text> into the chat:
				</Paragraph>
				<ul>
					{servers.map(text => <li key={text}>{text}</li>)}
				</ul>
			</li>
			<li>
				<Paragraph>Enter the code displayed in the in-game dialog here:</Paragraph>
				<Paragraph>
					<Form
						layout="inline"
						onFinish={values => {
							(async () => {
								let response = await fetch(`${webRoot}api/player_auth/player_code`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										player_code: values.player_code,
									}),
								});
								if (!response.ok) {
									throw new Error(`Bad server response: ${response.status}`);
								}

								let json = await response.json();
								if (json.error) {
									setPlayerCodeError("Invalid Code");
									setVerifyToken(null);
									return;
								}

								setPlayerCodeError(null);
								setPlayerCode(values.player_code);
								setVerifyCode(json.verify_code);
								setVerifyToken(json.verify_token);
							})().catch(notifyErrorHandler("Error verifying code"));
						}}
					>
						<Form.Item
							name="player_code"
							rules={[{ required: true, message: "Field is required" }]}
							help={playerCodeError}
							validateStatus={playerCodeError ? "error" : undefined}
						>
							<Input style={{ width: "10em" }} />
						</Form.Item>
						<Button type="primary" htmlType="submit">Verify</Button>
					</Form>
				</Paragraph>
			</li>
			<li>
				<Paragraph>Enter this code into the in-game dialog:</Paragraph>
				<Paragraph>
					<Input disabled={verifyCode === null} style={{ width: "10em" }} value={verifyCode} />
				</Paragraph>
			</li>
		</ol>
	</>;
}


export class WebPlugin extends libPlugin.BaseWebPlugin {
	async init() {
		this.logger.info("Player Auth init");
		this.loginForms = [{
			name: "player_auth.factorio",
			title: "Factorio",
			Component: LoginForm,
		}];
	}
}
