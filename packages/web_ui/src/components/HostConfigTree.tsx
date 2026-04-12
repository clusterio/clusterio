import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function HostConfigTree(props: { id: number, available: boolean }) {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.sendTo({ hostId: props.id }, new lib.HostConfigGetRequest());
	}

	async function setConfig(fields: Record<string, string | Record<string, string>>) {
		await control.sendTo({ hostId: props.id }, new lib.HostConfigSetRequest(fields));
	}

	return <BaseConfigTree
		ConfigClass={lib.HostConfig}
		retrieveConfig={retrieveConfig}
		setConfig={setConfig}
		id={props.id}
		available={props.available}
	/>;
}
