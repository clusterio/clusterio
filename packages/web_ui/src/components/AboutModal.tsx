import React, { useContext, useEffect, useMemo, useState } from "react";
import { Modal, Button, Space, Typography, message, Row, Col, Card } from "antd";
import { ReloadOutlined, CopyOutlined, InfoCircleOutlined } from "@ant-design/icons";

import { ControlContext, useAccount, useHosts, useInstances, useUsers } from "@clusterio/web_ui";
import { PluginWebApi } from "@clusterio/lib";
import webUiPackage from "../../package.json";

const { Text } = Typography;

function formatOS(os?: string) {
	switch (os) {
		case "win32": return "Windows";
		case "darwin": return "macOS";
		case "linux": return "Linux";
		default: return os;
	}
}

export default function AboutModal({ open, onClose, onOpenChangelog }: any) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [hosts] = useHosts();
	const [instances] = useInstances();
	const [users] = useUsers();

	const [pluginList, setPluginList] = useState<PluginWebApi[]>([]);

	useEffect(() => {
		(async () => {
			let response = await fetch(`${webRoot}api/plugins`);
			if (response.ok) {
				setPluginList(await response.json());
			}
		})();
	}, [webRoot]);

	const browserInfo = useMemo(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
	}), []);

	const debugText = useMemo(() => {
		const permissions = new Set(
			account.roles.flatMap(role => role.permissions)
		);

		const date = new Date();
		const lines: string[] = [
			"Clusterio Debug Info",
			`- Timestamp: ${date.toISOString()}`,
			`- Local Time: ${date.toString()}`,
			"",

			"Build",
			`- Version: ${webUiPackage.version}`,
			`- Build Date: ${process.env.BUILD_DATE}`,
			`- Commit Hash: ${process.env.COMMIT_HASH}`,
			`- Environment: ${process.env.BUILD_ENV}`,
			`- System: ${process.env.BUILD_OS}`,
			"",

			"Runtime",
			`- Platform: ${browserInfo.platform}`,
			`- User Agent: ${browserInfo.userAgent}`,
			`- Screen: ${window.screen.width}x${window.screen.height}`,
			`- Viewport: ${window.innerWidth}x${window.innerHeight}`,
			"",

			"Cluster",
			`- Url: ${new URL(webRoot, window.location.origin)}`,
			`- Hosts: ${hosts.size}`,
			`- Instances: ${instances.size}`,
			`- Plugins: ${pluginList.length}`,
			`- Users: ${users.size}`,
			"",

			"Account",
			`- Name: ${account.name}`,
			`- Roles: ${account.roles.map(r => r.name).sort().join(", ") || "None"}`,
			`- Permissions: ${permissions.size}`,
			"",

			"Permission List",
			...[...permissions].sort().map(p => `- ${p}`),
			"",
		];

		lines.push("Plugin List");
		for (let plugin of pluginList) {
			lines.push(`- ${plugin.name}`);
			lines.push(`  Version: ${plugin.version ?? "unknown"}`);
			lines.push(`  Loaded: ${plugin.loaded ? "yes" : "no"}`);
			lines.push(`  Controller: ${plugin.enabled ? "enabled" : "disabled"}`);
			lines.push(`  Web: ${control.plugins.get(plugin.name) ? "enabled" : "disabled"}`);
			if (plugin.npmPackage) {
				lines.push(`  Package: ${plugin.npmPackage}`);
			}
		}

		return lines.join("\n");
	}, [account, hosts, instances, users, pluginList, browserInfo]);

	async function copyDebug() {
		await navigator.clipboard.writeText(debugText);
		message.success("Copied debug info");
	}

	function forceRefresh() {
		window.location.reload();
	}

	return <Modal open={open} onCancel={onClose} footer={null} title="About Clusterio" width={800}>

		<Space direction="vertical" style={{ width: "100%" }} size="large">
			<Row gutter={[24, 16]}>
				<Col xs={24} md={12}>
					<Card title="Build Info">
						<Space direction="vertical">
							<Text>Version: {`${webUiPackage.version} (${process.env.COMMIT_HASH})`}</Text>
							<Text>Date: {new Date(process.env.BUILD_DATE ?? "").toLocaleString()}</Text>
							<Text>Environment: {process.env.BUILD_ENV}</Text>
							<Text>System: {formatOS(process.env.BUILD_OS)}</Text>
						</Space>
					</Card>
				</Col>

				<Col xs={24} md={12}>
					<Card title="Cluster Info">
						<Space direction="vertical">
							<Text>Hosts: {hosts.size}</Text>
							<Text>Instances: {instances.size}</Text>
							<Text>Plugins: {pluginList.length}</Text>
							<Text>Users: {users.size}</Text>
						</Space>
					</Card>
				</Col>
			</Row>

			<Row>
				<Col span={24}>
					<Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
						<Space wrap>
							<Button icon={<InfoCircleOutlined />} onClick={onOpenChangelog}>
								Changelog
							</Button>
							<Button
								target="_blank"
								href="https://github.com/clusterio/clusterio/issues"
								icon={<span style={{ display: "flex", alignItems: "center" }}>
									<img
										src="https://github.githubassets.com/favicons/favicon-dark.svg"
										style={{ width: 16 }}
									/>
								</span>}
							>
								GitHub Issues
							</Button>
							<Button
								target="_blank"
								href="https://discord.gg/mzAsgnm"
								icon={<span style={{ display: "flex", alignItems: "center" }}>
									<img
										// eslint-disable-next-line max-len
										src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d7f4ef6498ac018f2c55_Symbol.svg"
										style={{ width: 16}}
									/>
								</span>}
							>
								Support Server
							</Button>
						</Space>

						<Space wrap>
							<Button icon={<ReloadOutlined />} onClick={forceRefresh}>
								Reload
							</Button>
							<Button icon={<CopyOutlined />} onClick={copyDebug} type="primary">
								Copy Debug
							</Button>
						</Space>
					</Space>
				</Col>
			</Row>
		</Space>

	</Modal>;
}
