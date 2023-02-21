import React from "react";
import { Typography } from "antd";

import PluginExtra from "./PluginExtra";
import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import ControllerConfigTree from "./ControllerConfigTree";
import PageLayout from "./PageLayout";

const { Title } = Typography;


export default function ControllerPage() {
	let account = useAccount();

	return <PageLayout nav={[{ name: "Controller" }]}>
		<h2>Controller</h2>
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole controller={true} />
		</>}
		{account.hasPermission("core.controller.get_config") && <ControllerConfigTree />}
		<PluginExtra component="ControllerPage" />
	</PageLayout>;
};
