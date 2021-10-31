import React, { useContext } from "react";
import { Typography } from "antd";

import LogConsole from "./LogConsole";
import { useAccount } from "../model/account";
import MasterConfigTree from "./MasterConfigTree";
import PageLayout from "./PageLayout";

const { Title } = Typography;


export default function SlavesPage() {
	let account = useAccount();

	return <PageLayout nav={[{ name: "Master" }]}>
		<h2>Master</h2>
		{account.hasPermission("core.log.follow") && <>
			<Title level={5} style={{ marginTop: 16 }}>Console</Title>
			<LogConsole master={true} />
		</>}
		{account.hasPermission("core.master.get_config") && <MasterConfigTree />}
	</PageLayout>;
};
