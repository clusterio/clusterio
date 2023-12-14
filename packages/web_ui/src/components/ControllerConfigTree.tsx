import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function ControllerConfigTree() {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.send(new lib.ControllerConfigGetRequest());
	}

	async function setField(field: string, value: any) {
		await control.send(new lib.ControllerConfigSetFieldRequest(
			field,
			String(value),
		));
	}

	async function setProp(field: string, prop: string, value: any) {
		if (value) {
			try {
				value = JSON.parse(value);
			} catch (err) {
				return;
			}
		}
		await control.send(new lib.ControllerConfigSetPropRequest(field, prop, value));
	}

	return <BaseConfigTree
		ConfigClass={lib.ControllerConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
	/>;
}
