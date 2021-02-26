import React, { useContext } from "react";
import { Typography } from "antd";

import libLink from "@clusterio/lib/link";
import libConfig from "@clusterio/lib/config";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function InstanceConfigTree(props) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		let result = await libLink.messages.getInstanceConfig.send(control, {
			instance_id: props.id,
		});
		return result.serialized_config;
	}

	async function setField(field, value) {
		await libLink.messages.setInstanceConfigField.send(control, {
			instance_id: props.id,
			field,
			value: String(value),
		});
	}

	async function setProp(field, prop, value) {
		let data = {
			instance_id: props.id,
			field,
			prop,
		};
		if (value) {
			try {
				data.value = JSON.parse(value);
			} catch (err) {
				return;
			}
		}
		await libLink.messages.setInstanceConfigProp.send(control, data);
	}

	return <BaseConfigTree
		ConfigClass={libConfig.InstanceConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
		id={props.id}
	/>;
}
