import React, { useContext, useState } from "react";
import { Button, Form, Modal, Select, Typography } from "antd";

import { libLink } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { useHostList } from "../model/host";

const { Paragraph } = Typography;


export default function AssignInstanceModal(props) {
	let [visible, setVisible] = useState(false);
	let [hostList] = useHostList();
	let [applying, setApplying] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function open() {
		setVisible(true);
	}

	function handleAssign() {
		let hostId = form.getFieldValue("host");
		if (hostId === undefined) {
			setVisible(false);
			return;
		}

		if (hostId === "null") {
			hostId = null;
		}

		setApplying(true);
		libLink.messages.assignInstanceCommand.send(control, {
			instance_id: props.id,
			host_id: hostId,
		}).then(() => {
			setVisible(false);
			if (props.onFinish) {
				props.onFinish();
			}
		}).catch(
			notifyErrorHandler("Error assigning instance")
		).finally(
			() => setApplying(false)
		);
	}

	function handleCancel() {
		setVisible(false);
	}

	return <>
		<Button {...props.buttonProps} onClick={open}>
			{props.buttonContent || "Assign"}
		</Button>
		<Modal
			title="Assign Instance"
			okText="Assign"
			visible={visible}
			confirmLoading={applying}
			onOk={handleAssign}
			onCancel={handleCancel}
			destroyOnClose
		>
			<Paragraph style={{ maxWidth: "30em" }}>
				Select a Host to assign this instance to.  Assignment
				creates the necessary files on the host to start up
				the instance.  Note that reassigning an instance from
				one host to another will not move the server save over.
			</Paragraph>
			<Form form={form} initialValues={{ host: props.hostId === null ? "null" : props.hostId }}>
				<Form.Item name="host" label="Host">
					<Select>
						<Select.Option value={"null"}>
							<Typography.Text italic>Unassigned</Typography.Text>
						</Select.Option>
						{hostList.map((host) => <Select.Option
							key={host["id"]}
							value={host["id"]}
							disabled={!host["connected"]}
						>
							{host["name"]}
							{!host["connected"] && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

