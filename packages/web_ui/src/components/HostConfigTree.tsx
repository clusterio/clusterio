import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function HostConfigTree(props: { id: number, available: boolean }) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.sendTo({ hostId: props.id }, new lib.HostConfigGetRequest());
	}

	async function setField(field: string, value: any) {
		await control.sendTo({ hostId: props.id }, new lib.HostConfigSetFieldRequest(field, value));
	}

	async function setProp(field: string, prop: string, value: any) {
		if (value) {
			try {
				value = JSON.parse(value);
			} catch (err) {
				return;
			}
		} else {
			value = undefined;
		}
		await control.sendTo({ hostId: props.id }, new lib.HostConfigSetPropRequest(field, prop, value));
	}

	return <BaseConfigTree
		ConfigClass={lib.HostConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
		id={props.id}
		available={props.available}
	/>;
}
