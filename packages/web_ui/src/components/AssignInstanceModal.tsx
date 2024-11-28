import type { BaseButtonProps } from "antd/es/button/button";
import React, { useContext, useState } from "react";
import { Button, Form, Modal, Select, Typography } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";
import { useHosts } from "../model/host";

const { Paragraph } = Typography;
const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;


type AssignInstanceModalProps = {
	id?: number;
	hostId?: number;
	buttonProps: BaseButtonProps & { style: React.CSSProperties };
	buttonContent: string;
	onFinish?: () => void;
};
export default function AssignInstanceModal(props: AssignInstanceModalProps) {
	let [open, setOpen] = useState(false);
	let [hosts] = useHosts();
	let [applying, setApplying] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function handleAssign() {
		let hostId: number | string | undefined = form.getFieldValue("host");
		if (hostId === undefined) {
			setOpen(false);
			return;
		}

		if (typeof hostId === "string") {
			hostId = undefined;
		}

		setApplying(true);
		control.send(
			new lib.InstanceAssignRequest(props.id!, hostId)
		).then(() => {
			setOpen(false);
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
		setOpen(false);
	}

	return <>
		<Button {...props.buttonProps} onClick={() => setOpen(true)}>
			{props.buttonContent || "Assign"}
		</Button>
		<Modal
			title="Assign Instance"
			okText="Assign"
			open={open}
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
			<Form form={form} initialValues={{ host: props.hostId ?? "null" }}>
				<Form.Item name="host" label="Host">
					<Select showSearch optionFilterProp="name">
						<Select.Option value={"null"}>
							<Typography.Text italic>Unassigned</Typography.Text>
						</Select.Option>
						{[...hosts.values()].sort((a, b) => strcmp(a.name, b.name)).map((host) => <Select.Option
							key={host["id"]}
							value={host["id"]}
							name={host["name"]}
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
