import React, { useContext } from "react";

import { libConfig, libLink } from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function MasterConfigTree(props) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		let result = await libLink.messages.getMasterConfig.send(control);
		return result.serialized_config;
	}

	async function setField(field, value) {
		await libLink.messages.setMasterConfigField.send(control, {
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
		await libLink.messages.setMasterConfigProp.send(control, data);
	}

	return <BaseConfigTree
		ConfigClass={libConfig.MasterConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
	/>;
}
