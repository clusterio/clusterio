import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


type InstanceConfigTreeProps = {
	id: number;
};

export default function InstanceConfigTree(props: InstanceConfigTreeProps) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.send(new lib.InstanceConfigGetRequest(props.id));
	}

	async function setField(field: string, value: any) {
		await control.send(new lib.InstanceConfigSetFieldRequest(props.id, field, value));
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
		await control.send(new lib.InstanceConfigSetPropRequest(props.id, field, prop, value));
	}

	return <BaseConfigTree
		ConfigClass={lib.InstanceConfig}
		retrieveConfig={retrieveConfig}
		setField={setField}
		setProp={setProp}
		id={props.id}
	/>;
}
