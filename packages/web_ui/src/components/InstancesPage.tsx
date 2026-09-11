import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Checkbox, Form, Input, Modal, Select, Space, Tooltip, Typography } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useHosts } from "../model/host";
import { useInstanceConfig, useInstances } from "../model/instance";
import { useSaves } from "../model/saves";
import InstanceList from "./InstanceList";
import { notifyErrorHandler } from "../util/notify";

type SaveMode = "none" | "copy" | "save_and_copy";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function CreateInstanceButton(props: { instances: ReturnType<typeof useInstances>[0] }) {
	let control = useContext(ControlContext);
	let account = useAccount();
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [creating, setCreating] = useState(false);
	let [form] = Form.useForm();
	let [hosts] = useHosts();
	let [saves] = useSaves();

	const canAssign = account.hasPermission("core.instance.assign");
	const cloneId: number | undefined = Form.useWatch("instanceClone", form);
	const host: number | string | undefined = Form.useWatch("host", form);
	const saveMode: SaveMode = Form.useWatch("saveMode", form) ?? "none";
	const hostId = typeof host === "number" ? host : undefined;
	const source = cloneId !== undefined && cloneId >= 0 ? props.instances.get(cloneId) : undefined;
	const sourceRunning = source?.status === "running";
	const activeSave = source ? [...saves.values()].find(
		save => save.instanceId === source.id && (sourceRunning ? save.loaded : save.loadByDefault)
	) : undefined;
	const sourceConfig = useInstanceConfig(source?.id);
	const sourceSettings = sourceConfig?.["factorio.settings"] as Record<string, unknown> | undefined;
	const sourceServerName = typeof sourceSettings?.name === "string" ? sourceSettings.name : undefined;

	useEffect(() => {
		if (open && sourceServerName !== undefined) {
			form.setFieldValue("serverName", sourceServerName);
		}
	}, [open, sourceServerName]);

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}
		const copySave = source !== undefined && hostId !== undefined && saveMode !== "none";
		if (copySave && !activeSave) {
			form.setFields([{ name: "saveMode", errors: ["The source instance has no save to copy"] }]);
			return;
		}
		if (copySave && source.assignedHost === undefined) {
			form.setFields([{ name: "saveMode", errors: ["The source instance is not assigned to a host"] }]);
			return;
		}

		let instanceConfig = new lib.InstanceConfig("control");
		instanceConfig.set("instance.name", values.instanceName);
		const fields: (keyof lib.InstanceConfigFields)[] = ["instance.id", "instance.name"];
		if (source && sourceSettings) {
			if (!values.serverName) {
				form.setFields([{ name: "serverName", errors: ["Server name is required"] }]);
				return;
			}
			instanceConfig.set("factorio.settings", { ...sourceSettings, name: values.serverName });
			fields.push("factorio.settings");
		}
		const instanceId = instanceConfig.get("instance.id");

		setCreating(true);
		let created = false;
		try {
			await control.send(new lib.InstanceCreateRequest(
				instanceConfig.toRemote("controller", fields),
				source?.id,
			));
			created = true;

			if (hostId !== undefined) {
				await control.send(new lib.InstanceAssignRequest(instanceId, hostId));
			}

			let saveName: string | undefined;
			if (copySave) {
				if (saveMode === "save_and_copy") {
					await control.sendTo({ instanceId: source.id }, new lib.InstanceSaveGameRequest());
				}
				saveName = await control.send(new lib.InstanceTransferSaveRequest(
					source.id, activeSave!.name, instanceId, activeSave!.name, true,
				));
			}
			if (values.startAfter && hostId !== undefined) {
				await control.sendTo({ instanceId }, new lib.InstanceStartRequest(saveName));
			}
		} finally {
			setCreating(false);
			if (created) {
				setOpen(false);
				navigate(`/instances/${instanceId}/view`);
			}
		}
	}

	return <>
		<Button
			type="primary"
			onClick={() => {
				setOpen(true);
			}}
		>Create</Button>
		<Modal
			title="Create Instance"
			okText="Create"
			open={open}
			confirmLoading={creating}
			onOk={() => { createInstance().catch(notifyErrorHandler("Error creating instance")); }}
			onCancel={() => { setOpen(false); }}
			destroyOnHidden
		>
			<Form
				form={form}
				initialValues={{ host: "null", instanceClone: -1, saveMode: "none", startAfter: false }}
			>
				<Form.Item name="instanceName" label="Name">
					<Input />
				</Form.Item>
				{canAssign && <Form.Item name="host" label="Host">
					<Select showSearch optionFilterProp="name">
						<Select.Option value={"null"}>
							<Typography.Text italic>Unassigned</Typography.Text>
						</Select.Option>
						{[...hosts.values()].sort((a, b) => strcmp(a.name, b.name)).map(h => <Select.Option
							key={h.id}
							value={h.id}
							name={h.name}
							disabled={!h.connected}
						>
							{h.name}
							{!h.connected && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>}
				<Tooltip title="Perform a one time copy of the config of an existing instance">
					<Form.Item name="instanceClone" label="Copy Config">
						<Select
							options={[{ id: -1, name: "Default Config" }, ...props.instances.values()]
								.map(i => ({ value: i.id, label: i.name }))
							}
						/>
					</Form.Item>
				</Tooltip>
				{source && sourceSettings && <Tooltip title="Name of the server as shown in the in-game server browser">
					<Form.Item name="serverName" label="Server Name">
						<Input />
					</Form.Item>
				</Tooltip>}
				{source && hostId !== undefined && <Form.Item name="saveMode" label="Copy Save">
					<Select
						options={[
							{ value: "none", label: "None" },
							{
								value: "copy",
								label: activeSave ? `Copy ${activeSave.name}` : "Copy active save",
								disabled: !activeSave,
							},
							{
								value: "save_and_copy",
								label: "Save the running game and copy it",
								disabled: !sourceRunning || !activeSave,
							},
						]}
					/>
				</Form.Item>}
				{hostId !== undefined && <Form.Item
					name="startAfter"
					valuePropName="checked"
					extra={saveMode === "none" ? "A new save is created if none is copied" : undefined}
				>
					<Checkbox>Start after creation</Checkbox>
				</Form.Item>}
			</Form>
		</Modal>
	</>;
}

export default function InstancesPage() {
	let control = useContext(ControlContext);
	let account = useAccount();
	let [instances] = useInstances();

	return <PageLayout nav={[{ name: "Instances" }]}>
		<PageHeader
			title="Instances"
			extra={<Space>
				{account.hasPermission("core.instance.create") && <CreateInstanceButton instances={instances}/>}
				{account.hasPermission("core.instance.start")
					&& <Button onClick={e => instances.forEach(instance => {
						if (instance.status === "stopped" && !instance.excludeFromStartAll) {
							control.sendTo(
								{ instanceId: instance.id },
								new lib.InstanceStartRequest(undefined),
							).catch(notifyErrorHandler("Error starting instance"));
						}
					})
					}>
						Start all
					</Button>}
				{account.hasPermission("core.instance.stop")
					&& <Button onClick={e => instances.forEach(instance => {
						if (["starting", "running"].includes(instance.status)) {
							control.sendTo(
								{ instanceId: instance.id },
								new lib.InstanceStopRequest(),
							).catch(notifyErrorHandler("Error stopping instance"));
						}
					})
					}>
						Stop all
					</Button>}
			</Space>}
		/>

		<InstanceList instances={instances} />
		<PluginExtra component="InstancesPage" />
	</PageLayout>;
}
