import React, { useContext } from "react";

import { libConfig, libLink } from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function ControllerConfigTree(props) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		let result = await libLink.messages.getControllerConfig.send(control);
		return result.serialized_config;
	}

	async function setField(field, value) {
		await libLink.messages.setControllerConfigField.send(control, {
			field,
			value: String(value),
		});
	}

	async function setProp(field, prop, value) {
		let data = { field, prop };
		if (value) {
			try {
				data.value = JSON.parse(value);
			} catch (err) {
				return;
			}
		}
		await libLink.messages.setControllerConfigProp.send(control, data);
	}

	return <BaseConfigTree
		ConfigClass={libConfig.ControllerConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
	/>;
}
