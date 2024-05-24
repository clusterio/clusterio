import React, { useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Descriptions, Dropdown, MenuProps, Modal, Space, Spin, Typography } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import DownOutlined from "@ant-design/icons/DownOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import InstanceConfigTree from "./InstanceConfigTree";
import LogConsole from "./LogConsole";
import InstanceRcon from "./InstanceRcon";
import AssignInstanceModal from "./AssignInstanceModal";
import StartStopInstanceButton from "./StartStopInstanceButton";
import LoadScenarioModal from "./LoadScenarioModal";
import SavesList from "./SavesList";
import { notifyErrorHandler } from "../util/notify";
import { useInstance } from "../model/instance";
import { useHost } from "../model/host";
import InstanceStatusTag from "./InstanceStatusTag";
import Link from "./Link";

type MenuItem = Required<MenuProps>["items"][number];
const { Title } = Typography;

type InstanceDescriptionProps = {
	host?: Readonly<lib.HostDetails>;
	instance: Readonly<lib.InstanceDetails>;
};
function InstanceDescription(props: InstanceDescriptionProps) {
	let account = useAccount();

	const { host, instance } = props;
	let assigned = instance.assignedHost !== undefined;
	return <Descriptions
		bordered
		size="small"
	>
		<Descriptions.Item label="Host">
			{!assigned
				? <em>Unassigned</em>
				: <Link to={`/hosts/${host?.id ?? instance.assignedHost}/view`}>
					{host?.name ?? instance.assignedHost}
				</Link>
			}
			{account.hasPermission("core.instance.assign") && <AssignInstanceModal
				id={instance.id}
				hostId={instance.assignedHost}
				buttonProps={{
					size: "small",
					style: { float: "right" },
					type: assigned ? "default" : "primary",
					disabled: !["unknown", "unassigned", "stopped"].includes(instance.status!),
				}}
				buttonContent={assigned ? "Reassign" : "Assign"}
			/>}
		</Descriptions.Item>
		<Descriptions.Item label="Status"><InstanceStatusTag status={instance.status!} /></Descriptions.Item>
	</Descriptions>;
}

function InstanceButtons(props: { instance: lib.InstanceDetails }) {
	let account = useAccount();
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [exportingData, setExportingData] = useState(false);
	let instance = props.instance;
	let instanceId = instance.id!;

	let instanceButtonMenuItems: MenuItem[] = [];
	if (account.hasPermission("core.instance.export_data")) {
		instanceButtonMenuItems.push({
			disabled: exportingData || instance.status !== "stopped",
			key: "export",
			label: "Export data",
		});
	}
	if (account.hasPermission("core.instance.extract_players")) {
		instanceButtonMenuItems.push({
			disabled: instance.status !== "running",
			key: "extract",
			label: "Extract players from save",
		});
	}
	if (account.hasPermission("core.instance.kill")) {
		instanceButtonMenuItems.push({
			disabled: ["unknown", "unassigned", "stopped"].includes(instance.status!),
			key: "kill",
			label: "Kill process",
		});
	}
	if (account.hasPermission("core.instance.delete")) {
		if (instanceButtonMenuItems.length) {
			instanceButtonMenuItems.push({ type: "divider" });
		}
		instanceButtonMenuItems.push({
			disabled: !["unknown", "unassigned", "stopped"].includes(instance.status!),
			danger: true,
			key: "delete",
			icon: <DeleteOutlined />,
			label: "Delete",
		});
	}
	let instanceButtonsMenuProps: MenuProps = {
		items: instanceButtonMenuItems,
		onClick: ({ key }: { key: string }) => {
			if (key === "export") {
				setExportingData(true);
				control.sendTo(
					{ instanceId },
					new lib.InstanceExportDataRequest(),
				).catch(
					notifyErrorHandler("Error exporting data")
				).finally(() => {
					setExportingData(false);
				});

			} else if (key === "extract") {
				control.sendTo(
					{ instanceId },
					new lib.InstanceExtractPlayersRequest(),
				).catch(notifyErrorHandler("Error extracting player data"));

			} else if (key === "kill") {
				control.sendTo(
					{ instanceId },
					new lib.InstanceKillRequest(),
				).catch(notifyErrorHandler("Error killing instance"));

			} else if (key === "delete") {
				Modal.confirm({
					autoFocusButton: "cancel",
					content: "Permamently delete instance and server saves?",
					okText: "Delete",
					okButtonProps: { danger: true },
					onOk: () => {
						control.send(
							new lib.InstanceDeleteRequest(instanceId)
						).then(() => {
							navigate("/instances");
						}).catch(notifyErrorHandler("Error deleting instance"));
					},
				});
			}
		},
	};
	return <Space>
		{
			account.hasAnyPermission("core.instance.start", "core.instance.stop")
			&& <StartStopInstanceButton instance={instance} />
		}
		{account.hasPermission("core.instance.load_scenario") && <LoadScenarioModal instance={instance} />}
		{account.hasAnyPermission(
			"core.instance.export_data",
			"core.instance.extract_players",
			"core.instance.kill",
			"core.instance.delete",
		)
			&& <Dropdown placement="bottomRight" trigger={["click"]} menu={instanceButtonsMenuProps}>
				<Button>More <DownOutlined /></Button>
			</Dropdown>}
	</Space>;
}

export default function InstanceViewPage() {
	let params = useParams();
	let instanceId = Number(params.id);

	let navigate = useNavigate();

	let account = useAccount();
	let [instance, synced] = useInstance(instanceId);
	let [host] = useHost(instance?.assignedHost);

	let nav = [{ name: "Instances", path: "/instances" }, { name: instance?.name ?? String(instanceId) }];
	if (!instance) {
		if (!synced) {
			return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
		}

		return <PageLayout nav={nav}>
			<Alert
				message={"Instance not found"}
				showIcon
				description={<>Instance with id {instanceId} was not found on the controller.</>}
				type="warning"
				action={
					<Button
						type="text"
						onClick={() => { navigate("/instances"); }}
					>
						Go back to instances list
					</Button>
				}
			/>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		<PageHeader
			title={instance.name ?? ""}
			extra={<InstanceButtons instance={instance} />}
		/>
		<InstanceDescription host={host} instance={instance} />

		{
			account.hasAllPermission("core.instance.save.list", "core.instance.save.subscribe")
			&& <SavesList instance={instance} />
		}
		{
			account.hasAnyPermission("core.log.follow", "core.instance.send_rcon")
			&& <Title level={5} style={{ marginTop: 16 }}>Console</Title>
		}
		{account.hasPermission("core.log.follow") && <LogConsole instances={[instanceId]} />}
		{
			account.hasPermission("core.instance.send_rcon")
			&& <InstanceRcon id={instanceId} disabled={instance.status !== "running"} />
		}

		{account.hasPermission("core.instance.get_config") && <InstanceConfigTree id={instanceId} />}

		<PluginExtra component="InstanceViewPage" instance={instance} />
	</PageLayout>;
}
