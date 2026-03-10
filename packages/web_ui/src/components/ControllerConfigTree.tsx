import React, { useContext } from "react";

import * as lib from "@clusterio/lib";

import BaseConfigTree from "./BaseConfigTree";
import ControlContext from "./ControlContext";


export default function ControllerConfigTree() {
	let control = useContext(ControlContext);

	async function retrieveConfig() {
		return await control.send(new lib.ControllerConfigGetRequest());
	}

	async function setConfig(fields: Record<string, string | Record<string, string>>) {
		await control.send(new lib.ControllerConfigSetRequest(fields));
	}

	return <BaseConfigTree
		ConfigClass={lib.ControllerConfig}
		retrieveConfig={retrieveConfig}
		setConfig={setConfig}
	/>;
}
