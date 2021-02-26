import React, { useContext } from "react";

import MasterConfigTree from "./MasterConfigTree";
import PageLayout from "./PageLayout";


export default function SlavesPage() {
	return <PageLayout nav={[{ name: "Master" }]}>
		<h2>Master</h2>
		<MasterConfigTree />
	</PageLayout>;
};
