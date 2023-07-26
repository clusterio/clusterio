import React, { useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import { Button, Form, Input, Modal, PageHeader } from "antd";

import { libConfig, libData } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { useInstanceList } from "../model/instance";
import InstanceList from "./InstanceList";
import { notifyErrorHandler } from "../util/notify";

function CreateInstanceButton(props) {
	let control = useContext(ControlContext);
	let history = useHistory();
	let [visible, setVisible] = useState(false);
	let [form] = Form.useForm();

	async function createInstance() {
		let values = form.getFieldsValue();
		if (!values.instanceName) {
			form.setFields([{ name: "instanceName", errors: ["Name is required"] }]);
			return;
		}

		let instanceConfig = new libConfig.InstanceConfig("control");
		await instanceConfig.init();
		instanceConfig.set("instance.name", values.instanceName);
		let serializedConfig = instanceConfig.serialize("controller");
		await control.send(new libData.InstanceCreateRequest(serializedConfig));
		setVisible(false);
		history.push(`/instances/${instanceConfig.get("instance.id")}/view`);
	}

	return <>
		<Button
			type="primary"
			onClick={() => {
				setVisible(true);
			}}
		>Create</Button>
		<Modal
			title="Create Instance"
			okText="Create"
			visible={visible}
			onOk={() => { createInstance().catch(notifyErrorHandler("Error creating instance")); }}
			onCancel={() => { setVisible(false); }}
			destroyOnClose
		>
			<Form form={form}>
				<Form.Item name="instanceName" label="Name">
					<Input />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

export default function InstancesPage() {
	let control = useContext(ControlContext);
	let account = useAccount();
	let [instanceList] = useInstanceList();

	return <PageLayout nav={[{ name: "Instances" }]}>
		<PageHeader
			className="site-page-header"
			title="Instances"
			extra={<>
				{account.hasPermission("core.instance.create") && <CreateInstanceButton />}
				{account.hasPermission("core.instance.start")
					&& <Button onClick={e => instanceList.forEach(instance => {
						if (instance.status === "stopped") {
							control.send(
								new libData.InstanceStartRequest(undefined), { instanceId: instance.id }
							).catch(notifyErrorHandler("Error starting instance"));
						}
					})
					}>
						Start all
					</Button>}
				{account.hasPermission("core.instance.stop")
					&& <Button onClick={e => instanceList.forEach(instance => {
						if (["starting", "running"].includes(instance.status)) {
							control.sendTo(
								{ instanceId: instance.id },
								new libData.InstanceStopRequest(),
							).catch(notifyErrorHandler("Error stopping instance"));
						}
					})
					}>
						Stop all
					</Button>}
			</>}
		/>

		<InstanceList instances={instanceList} />
		<PluginExtra component="InstancesPage" />
	</PageLayout>;
}
