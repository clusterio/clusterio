import React, { useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Descriptions, Dropdown, Flex, MenuProps, Modal, Space, Spin, Switch, Typography } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import DownOutlined from "@ant-design/icons/DownOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import InstanceConfigTree from "./InstanceConfigTree";
import LogConsole, { SelectMaxLogLevel } from "./LogConsole";
import InstanceRcon from "./InstanceRcon";
import AssignInstanceModal from "./AssignInstanceModal";
import InstanceControlButton, { InstanceControlButtonPermissions } from "./InstanceControlButton";
import LoadScenarioModal from "./LoadScenarioModal";
import SavesList from "./SavesList";
import OnlinePlayersList from "./OnlinePlayersList";
import { notifyErrorHandler } from "../util/notify";
import { useInstance } from "../model/instance";
import { useHost } from "../model/host";
import InstanceStatusTag from "./InstanceStatusTag";
import Link from "./Link";
import { instancePublicAddress } from "../util/instance";

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
		<Descriptions.Item label="Version">
			{instance.factorioVersion ?? "unknown"}
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
	let [host] = useHost(instance.assignedHost);

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
			account.hasAnyPermission(...InstanceControlButtonPermissions)
			&& <InstanceControlButton instance={instance} />
		}
		<Button
			onClick={() => {
				const address = instancePublicAddress(instance, host);
				if (address) {
					window.location.href = `steam://run/427520//--mp-connect=${address}`;
				}
			}}
			disabled={instance.status !== "running" || !instancePublicAddress(instance, host)}
		>
			Connect via Steam
		</Button>
		{account.hasPermission("core.instance.load_scenario") && <LoadScenarioModal instance={instance} />}
		{account.hasAnyPermission(
			"core.instance.export_data",
			"core.instance.extract_players",
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
	const [maxLevel, setMaxLevel] = useState<keyof typeof lib.levels>("server");
	const [actionsOnly, setActionsOnly] = useState<boolean>(true);

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

		{account.hasPermission("core.user.list") && <OnlinePlayersList instanceId={instanceId} />}

		{
			account.hasAllPermission("core.instance.save.list", "core.instance.save.subscribe")
			&& <SavesList instance={instance} />
		}
		{
			account.hasAnyPermission("core.log.follow", "core.instance.send_rcon")
			&& <Flex justify="space-between" align="baseline">
				<Title level={5} style={{ marginTop: 16 }}>Console</Title>
				{
					account.hasPermission("core.log.follow")
					&& <Flex align="center" gap="middle">
						<Switch
							checkedChildren="Chat"
							unCheckedChildren="Log"
							checked={actionsOnly}
							onChange={setActionsOnly}
						/>
						<SelectMaxLogLevel
							value={maxLevel}
							onChange={setMaxLevel}
							hidden={["http"]}
						/>
					</Flex>
				}
			</Flex>
		}
		{
			account.hasPermission("core.log.follow")
			&& <LogConsole instances={[instanceId]} maxLevel={maxLevel} actionsOnly={actionsOnly}/>
		}
		{
			account.hasPermission("core.instance.send_rcon")
			&& <InstanceRcon id={instanceId} disabled={instance.status !== "running"} />
		}

		{account.hasPermission("core.instance.get_config") && <InstanceConfigTree id={instanceId} />}

		<PluginExtra component="InstanceViewPage" instance={instance} />
	</PageLayout>;
}
