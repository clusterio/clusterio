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

	async function setConfig(fields: Record<string, string | Record<string, string>>) {
		await control.send(new lib.InstanceConfigSetRequest(props.id, fields));
	}

	return <BaseConfigTree
		ConfigClass={lib.InstanceConfig}
		retrieveConfig={retrieveConfig}
		setConfig={setConfig}
		id={props.id}
	/>;
}
