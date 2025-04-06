import React, { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Select, Tooltip } from "antd";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useInstances } from "../model/instance";
import InstanceList from "./InstanceList";
import { notifyErrorHandler } from "../util/notify";

function CreateInstanceButton(props: { instances: ReturnType<typeof useInstances>[0] }) {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}

		let instanceConfig = new lib.InstanceConfig("control");
		instanceConfig.set("instance.name", values.instanceName);

		await control.send(new lib.InstanceCreateRequest(
			instanceConfig.toRemote("controller", [
				"instance.id", "instance.name",
			]),
			values.instanceClone >= 0 ? values.instanceClone : undefined,
		));

		setOpen(false);
		navigate(`/instances/${instanceConfig.get("instance.id")}/view`);
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
			onOk={() => { createInstance().catch(notifyErrorHandler("Error creating instance")); }}
			onCancel={() => { setOpen(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="instanceName" label="Name">
					<Input />
				</Form.Item>
				<Tooltip title="Perform a one time copy of an existing config (assigned host is not copied)">
					<Form.Item name="instanceClone" label="Copy Config">
						<Select
							defaultValue={-1}
							options={[{ id: -1, name: "Default Config" }, ...props.instances.values()]
								.map(i => ({ value: i.id, label: i.name }))
							}
						/>
					</Form.Item>
				</Tooltip>
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
			extra={<>
				{account.hasPermission("core.instance.create") && <CreateInstanceButton instances={instances}/>}
				{account.hasPermission("core.instance.start")
					&& <Button onClick={e => instances.forEach(instance => {
						if (instance.status === "stopped") {
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
			</>}
		/>

		<InstanceList instances={instances} />
		<PluginExtra component="InstancesPage" />
	</PageLayout>;
}
