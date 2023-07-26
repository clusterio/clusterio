import React, { useContext } from "react";

import { libConfig, libData } from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function ControllerConfigTree(props) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		let result = await control.send(new libData.ControllerConfigGetRequest());
		return result.serializedConfig;
	}

	async function setField(field, value) {
		await control.send(new libData.ControllerConfigSetFieldRequest(
			field,
			String(value),
		));
	}

	async function setProp(field, prop, value) {
		if (value) {
			try {
				value = JSON.parse(value);
			} catch (err) {
				return;
			}
		}
		await control.send(new libData.ControllerConfigSetPropRequest(field, prop, value));
	}

	return <BaseConfigTree
		ConfigClass={libConfig.ControllerConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
	/>;
}
