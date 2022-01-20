import React, { useContext, useState } from "react";
import { Button, Form, Modal, Select, Typography } from "antd";

import { libLink } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { useSlaveList } from "../model/slave";

const { Paragraph } = Typography;

export default function MigrateInstanceModal(props) {
	let [visible, setVisible] = useState(false);
	let [slaveList] = useSlaveList();
	let [applying, setApplying] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function open() {
		setVisible(true);
	}

	function handleMigrate() {
		let slaveId = form.getFieldValue("slave");
		if (slaveId === undefined) {
			setVisible(false);
			return;
		}

		setApplying(true);
		libLink.messages.migrateInstanceCommand.send(control, {
			instance_id: props.id,
			slave_id: slaveId,
		}).then(() => {
			setVisible(false);
			if (props.onFinish) {
				props.onFinish();
			}
		}).catch(
			notifyErrorHandler("Error migrating instance")
		).finally(
			() => setApplying(false)
		);
	}

	function handleCancel() {
		setVisible(false);
	}

	return <>
		<Button {...props.buttonProps} onClick={open}>
			{props.buttonContent || "Migrate"}
		</Button>
		<Modal
			title="Migrate Instance"
			okText="Migrate"
			visible={visible}
			confirmLoading={applying}
			onOk={handleMigrate}
			onCancel={handleCancel}
			destroyOnClose
		>
			<Paragraph style={{ maxWidth: "30em" }}>
				Select a Slave to migrate this instance to. Migration
				moves savefiles from one slave to another then reassigns it.
				Configuration files are synchronized through the config system.
				If the instance was running when the migration was initiated,
				it will be stopped and restarted on the new slave.
			</Paragraph>
			<Paragraph style={{ maxWidth: "30em" }}>
				If the migration fails, the files will remain on the old slave
				while partial data might be located on the destination slave.
				The automatic recovery process will attempt to recover the
				instance by assigning it to the same slave it was on before.
				If the automatic recovery fails, attempt a manual recovery
				by assigning the instance to the original slave.
			</Paragraph>
			<Form form={form} initialValues={{
				slave: slaveList.filter(slave => slave["id"] !== props.slaveId)[0]?.["id"],
			}}>
				<Form.Item name="slave" label="Slave">
					<Select>
						{slaveList
							.filter(slave => slave["id"] !== props.slaveId)
							.map((slave) => <Select.Option
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
