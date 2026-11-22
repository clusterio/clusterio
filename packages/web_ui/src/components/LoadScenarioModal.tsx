import React, { useContext, useState } from "react";
import { Button, Form, Input, Modal } from "antd";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { notifyErrorHandler } from "../util/notify";

type LoadScenarioModalProps = {
	instance: lib.InstanceDetails;
	open: boolean;
	onClose: () => void;
};
export default function LoadScenarioModal(props: LoadScenarioModalProps) {
	let [loadingScenario, setLoadingScenario] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function loadScenario() {
		let values = form.getFieldsValue();
		let scenario = values.scenario || "base/freeplay";
		let seed = values.seed === undefined ? undefined : Number.parseInt(values.seed, 10);
		let mapGenSettings;
		let mapSettings;
		if (values.exchangeString && values.exchangeString.trim()) {
			let result;
			try {
				result = lib.readMapExchangeString(values.exchangeString);
			} catch (err: any) {
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
			} catch (err: any) {
				form.setFields([{ name: "mapGenSettings", errors: [err.message] }]);
				return;
			}
			form.setFields([{ name: "mapGenSettings", errors: [] }]);
		}
		if (values.mapSettings && values.mapSettings.trim()) {
			try {
				mapSettings = JSON.parse(values.mapSettings);
			} catch (err: any) {
				form.setFields([{ name: "mapSettings", errors: [err.message] }]);
				return;
			}
			form.setFields([{ name: "mapSettings", errors: [] }]);
		}

		setLoadingScenario(true);
		control.sendTo(
			{ instanceId: props.instance.id },
			new lib.InstanceLoadScenarioRequest(scenario, seed, mapGenSettings, mapSettings),
		).then(() => {
			props.onClose();
		}).catch(
			notifyErrorHandler("Error loading scenario")
		).finally(() => {
			setLoadingScenario(false);
		});
	}

	function convertExchangeString() {
		let exchangeString = form.getFieldValue("exchangeString");
		let result;
		try {
			result = lib.readMapExchangeString(exchangeString);
		} catch (err: any) {
			form.setFields([{ name: "exchangeString", errors: [err.message] }]);
			return;
		}
		form.setFields([{ name: "exchangeString", errors: [], value: "" }]);
		form.setFieldsValue({
			mapGenSettings: JSON.stringify(result.map_gen_settings, null, "\t"),
			mapSettings: JSON.stringify(result.map_settings, null, "\t"),
		});
	}

	return <Modal
		title="Load Scenario"
		width={560}
		okText="Load"
		open={props.open}
		confirmLoading={loadingScenario}
		onOk={loadScenario}
		onCancel={props.onClose}
		destroyOnHidden
	>
		<Form form={form} layout="vertical">
			<Form.Item name="scenario" label="Scenario">
				<Input placeholder="base/freeplay" />
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
	</Modal>;
}
