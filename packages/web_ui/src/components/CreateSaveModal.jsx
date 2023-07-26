import React, { useContext, useState } from "react";
import { Button, Form, Input, Modal } from "antd";

import { libFactorio, libData } from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";


export default function CreateSaveModal(props) {
	let [visible, setVisible] = useState(false);
	let [creatingSave, setCreatingSave] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function createSave() {
		let values = form.getFieldsValue();
		let name = values.saveName || "world.zip";
		let seed = values.seed === undefined ? null : Number.parseInt(values.seed, 10);
		let mapGenSettings = null;
		let mapSettings = null;
		if (values.exchangeString && values.exchangeString.trim()) {
			let result;
			try {
				result = libFactorio.readMapExchangeString(values.exchangeString);
			} catch (err) {
				form.setFields([{ name: "exchangeString", errors: [err.message] }]);
				return;
			}
			form.setFields([{ name: "exchangeString", errors: [] }]);
			mapGenSettings = result.map_gen_settings;
			mapSettings = result.map_settings;
		}
		if (values.mapGenSettings && values.mapGenSettings.trim()) {
			try {
				mapGenSettings = JSON.parse(values.mapGenSettings);
			} catch (err) {
				form.setFields([{ name: "mapGenSettings", errors: [err.message] }]);
				return;
			}
			form.setFields([{ name: "mapGenSettings", errors: [] }]);
		}
		if (values.mapSettings && values.mapSettings.trim()) {
			try {
				mapSettings = JSON.parse(values.mapSettings);
			} catch (err) {
				form.setFields([{ name: "mapSettings", errors: [err.message] }]);
				return;
			}
			form.setFields([{ name: "mapSettings", errors: [] }]);
		}

		setCreatingSave(true);
		control.sendTo(
			{ instanceId: props.instance.id },
			new libData.InstanceCreateSaveRequest(name, seed, mapGenSettings, mapSettings),
		).then(() => {
			form.resetFields();
			setVisible(false);
		}).catch(
			notifyErrorHandler("Error creating save")
		).finally(() => {
			setCreatingSave(false);
		});
	}

	function convertExchangeString() {
		let exchangeString = form.getFieldValue("exchangeString");
		let result;
		try {
			result = libFactorio.readMapExchangeString(exchangeString);
		} catch (err) {
			form.setFields([{ name: "exchangeString", errors: [err.message] }]);
			return;
		}
		form.setFields([{ name: "exchangeString", errors: [], value: "" }]);
		form.setFieldsValue({
			mapGenSettings: JSON.stringify(result.map_gen_settings, null, 4),
			mapSettings: JSON.stringify(result.map_settings, null, 4),
		});
	}

	function handleCancel() {
		setVisible(false);
	}

	return <>
		<Button
			loading={creatingSave}
			disabled={props.instance.status !== "stopped"}
			onClick={() => {
				setVisible(true);
			}}
		>
			Create save
		</Button>
		<Modal
			title="Create Save"
			width={560}
			okText="Create"
			visible={visible}
			confirmLoading={creatingSave}
			onOk={createSave}
			onCancel={handleCancel}
			destroyOnClose
		>
			<Form form={form} layout="vertical">
				<Form.Item name="saveName" label="Save Name">
					<Input placeholder="world.zip" />
				</Form.Item>
				<Form.Item name="seed" label="Seed">
					<Input type="number" />
				</Form.Item>
				<Form.Item name="exchangeString" label="Map Exchange String">
					<Input.TextArea allowClear={true} autoSize={{ minRows: 3 }} />
				</Form.Item>
				<div style={{ textAlign: "right", marginTop: -8 }}>
					<Button onClick={() => convertExchangeString()}>Convert to settings</Button>
				</div>
				<Form.Item
					name="mapGenSettings"
					label="Map Gen Settings"
					tooltip="JSON data to pass to Factorio with --map-gen-settings, overrides Map Exchange String"
				>
					<Input.TextArea allowClear={true} autoSize={{ minRows: 1 }} />
				</Form.Item>
				<Form.Item
					name="mapSettings"
					label="Map Settings"
					tooltip="JSON data to pass to Factorio with --map-settings, overrides Map Exchange String"
				>
					<Input.TextArea allowClear={true} autoSize={{ minRows: 1 }} />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}
