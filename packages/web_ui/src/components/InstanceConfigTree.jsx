import React, { useContext } from "react";

import { libConfig, libData } from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function InstanceConfigTree(props) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		let result = await control.send(new libData.InstanceConfigGetRequest(props.id));
		return result.config;
	}

	async function setField(field, value) {
		await control.send(new libData.InstanceConfigSetFieldRequest(props.id, field, value));
	}

	async function setProp(field, prop, value) {
		if (value) {
			try {
				value = JSON.parse(value);
			} catch (err) {
				return;
			}
		}
		await control.send(new libData.InstanceConfigSetPropRequest(props.id, field, prop, value));
	}

	return <BaseConfigTree
		ConfigClass={libConfig.InstanceConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
		id={props.id}
	/>;
}
