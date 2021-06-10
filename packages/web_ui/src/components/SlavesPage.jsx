import React, { useContext } from "react";
import { Table } from "antd";

import libLink from "@clusterio/lib/link";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { useSlaveList } from "../model/slave";


export default function SlavesPage() {
	let control = useContext(ControlContext);
	let [slaveList] = useSlaveList();

	return <PageLayout nav={[{ name: "Slaves" }]}>
		<h2>Slaves</h2>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
				},
				{
					title: "Agent",
					dataIndex: "agent",
				},
				{
					title: "Version",
					dataIndex: "version",
				},
				{
					title: "Connected",
					key: "connected",
					render: slave => slave["connected"] && "Yes",
				},
			]}
			dataSource={slaveList}
			rowKey={slave => slave["id"]}
			pagination={false}
		/>
	</PageLayout>;
};
