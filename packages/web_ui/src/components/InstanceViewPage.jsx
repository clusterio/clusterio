import React, { useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Button, Descriptions, Popconfirm, Space, Spin, Typography } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import libLink from "@clusterio/lib/link";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import InstanceConfigTree from "./InstanceConfigTree";
import InstanceConsole from "./InstanceConsole";
import InstanceRcon from "./InstanceRcon";
import AssignInstanceModal from "./AssignInstanceModal";
import StartStopInstanceButton from "./StartStopInstanceButton";
import CreateSaveModal from "./CreateSaveModal";
import LoadScenarioModal from "./LoadScenarioModal";
import SavesList from "./SavesList";
import SectionHeader from "./SectionHeader";
import { notifyErrorHandler } from "../util/notify";
import { useInstance } from "../model/instance";
import { useSlave } from "../model/slave";

const { Title, Paragraph } = Typography;


export default function InstanceViewPage(props) {
	let params = useParams();
	let instanceId = Number(params.id);

	let history = useHistory();

	let control = useContext(ControlContext);
	let [instance] = useInstance(instanceId);
	let [slave] = useSlave(Number(instance["assigned_slave"]));

	let [exportingData, setExportingData] = useState(false);

	let nav = [{ name: "Instances", path: "/instances" }, { name: instance.name || "Unknown" }];
	if (instance.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (instance.missing) {
		return <PageLayout nav={nav}>
			<h2>Instance not found</h2>
			<p>Instance with id {instanceId} was not found on the master server.</p>
		</PageLayout>;
	}

	let instanceButtons = <Space>
		<StartStopInstanceButton instance={instance} />
		<LoadScenarioModal instance={instance} />
		<Button
			loading={exportingData}
			disabled={instance.status !== "stopped"}
			onClick={() => {
				setExportingData(true);
				libLink.messages.exportData.send(
					control, { instance_id: instanceId }
				).catch(
					notifyErrorHandler("Error exporting data")
				).finally(() => {
					setExportingData(false);
				});
			}}
		>
			Export data
		</Button>
		<Popconfirm
			title="Permanently delete instance and server saves?"
			okText="Delete"
			placement="bottomRight"
			okButtonProps={{ danger: true }}
			onConfirm={() => {
				libLink.messages.deleteInstance.send(
					control, { instance_id: instanceId }
				).then(() => {
					history.push("/instances");
				}).catch(notifyErrorHandler("Error deleting instance"));
			}}
		>
			<Button
				danger
				disabled={!["unknown", "unassigned", "stopped"].includes(instance["status"])}
			>
				<DeleteOutlined />
			</Button>
		</Popconfirm>
	</Space>;

	let assigned = instance["assigned_slave"] !== null;
	return <PageLayout nav={nav}>
		<Descriptions
			bordered
			size="small"
			title={instance["name"]}
			extra={instanceButtons}
		>
			<Descriptions.Item label="Slave">
				{!assigned
					? <em>Unassigned</em>
					: slave["name"] || instance["assigned_slave"]
				}
				<AssignInstanceModal
					id={instanceId}
					slaveId={instance["assigned_slave"]}
					buttonProps={{
						size: "small",
						style: { float: "Right" },
						type: assigned ? "default" : "primary",
						disabled: !["unknown", "unassigned", "stopped"].includes(instance["status"]),
					}}
					buttonContent={assigned ? "Reassign" : "Assign"}
				/>
			</Descriptions.Item>
			<Descriptions.Item label="Status">{instance["status"]}</Descriptions.Item>
		</Descriptions>

		<SectionHeader title="Saves" extra=<CreateSaveModal instance={instance} /> />
		<SavesList instance={instance} />
		<Title level={5} style={{ marginTop: 16 }}>Console</Title>
		<InstanceConsole id={instanceId} />
		<InstanceRcon id={instanceId} disabled={instance["status"] !== "running"} />

		<InstanceConfigTree id={instanceId} />
	</PageLayout>;
}
