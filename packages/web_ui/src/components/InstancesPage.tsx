import React, { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Checkbox, Form, Input, Modal, Select, Space, Tooltip } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useInstances } from "../model/instance";
import { useSaves } from "../model/saves";
import InstanceList from "./InstanceList";
import { notifyErrorHandler } from "../util/notify";

type SaveMode = "none" | "copy" | "save_and_copy";

function CreateInstanceButton(props: { instances: ReturnType<typeof useInstances>[0] }) {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [creating, setCreating] = useState(false);
	let [form] = Form.useForm();
	let [saves] = useSaves();

	const cloneId: number | undefined = Form.useWatch("instanceClone", form);
	const saveMode: SaveMode = Form.useWatch("saveMode", form) ?? "none";
	const source = cloneId !== undefined && cloneId >= 0 ? props.instances.get(cloneId) : undefined;
	const sourceRunning = source?.status === "running";
	const activeSave = source ? [...saves.values()].find(
		save => save.instanceId === source.id && (sourceRunning ? save.loaded : save.loadByDefault)
	) : undefined;

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}
		const copySave = source !== undefined && saveMode !== "none";
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
		const instanceId = instanceConfig.get("instance.id");

		setCreating(true);
		let created = false;
		try {
			await control.send(new lib.InstanceCreateRequest(
				instanceConfig.toRemote("controller", [
					"instance.id", "instance.name",
				]),
				source?.id,
			));
			created = true;

			if (copySave) {
				await control.send(new lib.InstanceAssignRequest(instanceId, source.assignedHost));
				if (saveMode === "save_and_copy") {
					await control.sendTo({ instanceId: source.id }, new lib.InstanceSaveGameRequest());
				}
				const saveName = await control.send(new lib.InstanceTransferSaveRequest(
					source.id, activeSave!.name, instanceId, activeSave!.name, true,
				));
				if (values.startAfter) {
					await control.sendTo({ instanceId }, new lib.InstanceStartRequest(saveName));
				}
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
			<Form form={form} initialValues={{ instanceClone: -1, saveMode: "none", startAfter: false }}>
				<Form.Item name="instanceName" label="Name">
					<Input />
				</Form.Item>
				<Tooltip
					title="Perform a one time copy of an existing config (the host is only copied along with a save)"
				>
					<Form.Item name="instanceClone" label="Copy Config">
						<Select
							options={[{ id: -1, name: "Default Config" }, ...props.instances.values()]
								.map(i => ({ value: i.id, label: i.name }))
							}
						/>
					</Form.Item>
				</Tooltip>
				{source && <>
					<Form.Item
						name="saveMode"
						label="Copy Save"
						extra={
							saveMode !== "none" ? "The new instance is assigned to the host of the source" : undefined
						}
					>
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
									label: activeSave
										? `Save the running game and copy ${activeSave.name}`
										: "Save and copy",
									disabled: !sourceRunning || !activeSave,
								},
							]}
						/>
					</Form.Item>
					<Form.Item name="startAfter" valuePropName="checked">
						<Checkbox disabled={saveMode === "none"}>Start after creation</Checkbox>
					</Form.Item>
				</>}
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
