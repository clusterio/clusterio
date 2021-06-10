import React, { useContext, useState } from "react";
import { Button, Form, Modal, Select, Typography } from "antd";

import libLink from "@clusterio/lib/link";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { useSlaveList } from "../model/slave";

const { Paragraph } = Typography;


export default function AssignInstanceModal(props) {
	let [visible, setVisible] = useState(false);
	let [slaveList] = useSlaveList();
	let [applying, setApplying] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function open() {
		setVisible(true);
	}

	function handleAssign() {
		let slaveId = form.getFieldValue("slave");
		if (slaveId === undefined) {
			setVisible(false);
			return;
		}

		setApplying(true);
		libLink.messages.assignInstanceCommand.send(control, {
			instance_id: props.id,
			slave_id: slaveId,
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
				Select a Slave to assign this instance to.  Assignment
				creates the necessary files on the slave to start up
				the instance.  Note that reassigning an instance from
				one slave to another will not move the server save over.
			</Paragraph>
			<Form form={form} initialValues={{ slave: props.slaveId }}>
				<Form.Item name="slave" label="Slave">
					<Select>
						{slaveList.map((slave) => <Select.Option
							key={slave["id"]}
							value={slave["id"]}
							disabled={!slave["connected"]}
						>
							{slave["name"]}
							{!slave["connected"] && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

