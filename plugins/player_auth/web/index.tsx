import React, { useEffect, useState } from "react";

import { BaseWebPlugin, notifyErrorHandler } from "@clusterio/web_ui";
import { Alert, Button, Form, Input, Modal, Space, Spin, Typography } from "antd";

import { PlayerAuthServer } from "../messages";
import "./style.css";

const { Paragraph, Text } = Typography;

interface LoginFormProps {
	setToken(token: string): void,
}

function LoginForm(props: LoginFormProps) {
	const [servers, setServers] = useState<PlayerAuthServer[] | null>(null);
	let [playerCode, setPlayerCode] = useState<string | null>(null);
	let [playerCodeError, setPlayerCodeError] = useState<string | null>(null);
	let [verifyCode, setVerifyCode] = useState<string | undefined>();
	let [verifyToken, setVerifyToken] = useState<string | null>(null);
	const [connectServer, setConnectServer] = useState<{ name: string, address: string } | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function loadServers() {
			try {
				const response = await fetch(`${webRoot}api/player_auth/servers`);
				if (!response.ok) {
					throw new Error(`Bad server response: ${response.status}`);
				}

				const data = await response.json();
				if (!cancelled) {
					setServers(data);
				}
			} catch (err) {
				if (!cancelled && err instanceof Error) {
					setServers([]);
					notifyErrorHandler("Error fetching servers")(err);
				}
			}
		}

		loadServers();
		const interval = setInterval(loadServers, 15 * 1000);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		if (!verifyToken) {
			return undefined;
		}

		let cancelled = false;
		async function verify() {
			try {
				const response = await fetch(`${webRoot}api/player_auth/verify`, {
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

				const json = await response.json();
				if (cancelled) {
					return;
				}

				if (json.error) {
					setPlayerCodeError("Code expired");
					setVerifyToken(null);
					clearInterval(interval);
					return;
				}

				if (json.verified) {
					props.setToken(json.token);
				}
			} catch (err) {
				if (!cancelled && err instanceof Error) {
					clearInterval(interval);
					notifyErrorHandler("Error verifying code")(err);
				}
			}
		}

		verify();
		const interval = setInterval(verify, 2 * 1000);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [verifyToken]);

	if (!servers) {
		return <Spin size="large" />;
	}

	if (servers.length === 0) {
		return <Paragraph>
			There are no running servers available for login via Factorio at the moment.
			Please try again later.
		</Paragraph>;
	}

	return <>
		<Modal
			open={connectServer !== null}
			title={`Connect to ${connectServer?.name ?? ""}`}
			okText="Connect"
			cancelText="Back"
			onCancel={() => setConnectServer(null)}
			onOk={() => {
				if (!connectServer) {
					return;
				}

				window.location.href = `steam://run/427520//--mp-connect=${connectServer.address}`;
				setConnectServer(null);
			}}
		>
			<Space direction="vertical" style={{ width: "100%" }}>
				<Paragraph>
					This button launches Factorio through Steam. It only works if
					you own and have installed the Steam version of Factorio, and
					Factorio is not already running.
				</Paragraph>

				<Paragraph>
					If you are using the standalone version, or Factorio is already
					running, use the following address with <b>Multiplayer → Connect to address</b>:
				</Paragraph>

				<Typography.Paragraph
					copyable={{ text: connectServer?.address ?? "" }}
					style={{ marginBottom: 0 }}
				>
					{connectServer?.address}
				</Typography.Paragraph>
			</Space>
		</Modal>
		<Paragraph>Login using your Factorio account is a 3 step process:</Paragraph>
		<style>
		</style>
		<ol className="factorio-login-steps">
			<li>
				<Paragraph>
					Start Factorio, join one of the following multiplayer servers
					and type <Text keyboard>/web-login</Text> into the chat:
				</Paragraph>
				<div style={{ maxHeight: 160, overflowY: "auto", paddingLeft: 16, padding: "8px 0" }}>
					<ul style={{ margin: 0, paddingLeft: 16 }}>
						{servers.map(server => (
							<li key={server.name} style={{ marginBottom: 6 }}>
								<div style={{
									display: "grid",
									gridTemplateColumns: "1fr auto",
									alignItems: "center",
									gap: 8,
								}}>
									<span>
										{server.name}
										{server.factorioVersion && (
											<Text type="secondary"> ({server.factorioVersion})</Text>
										)}
									</span>

									{server.address && (
										<Button
											size="small"
											onClick={() => {
												setConnectServer({
													name: server.name,
													address: server.address!,
												});
											}}
										>
											Connect
										</Button>
									)}
								</div>
							</li>
						))}
					</ul>
				</div>
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
					<Input disabled={verifyCode === undefined} style={{ width: "10em" }} value={verifyCode} />
				</Paragraph>
			</li>
		</ol>
	</>;
}


export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.logger.info("Player Auth init");
		this.loginForms = [{
			name: "player_auth.factorio",
			title: "Factorio",
			Component: LoginForm,
		}];
	}
}
