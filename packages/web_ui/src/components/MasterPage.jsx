import React, { useContext } from "react";

import { useAccount } from "../model/account";
import MasterConfigTree from "./MasterConfigTree";
import PageLayout from "./PageLayout";


export default function SlavesPage() {
	let account = useAccount();

	return <PageLayout nav={[{ name: "Master" }]}>
		<h2>Master</h2>
		{account.hasPermission("core.master.get_config") && <MasterConfigTree />}
	</PageLayout>;
};
