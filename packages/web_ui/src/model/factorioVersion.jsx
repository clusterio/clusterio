import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import { libLink, libLogging } from "@clusterio/lib";
const { logger } = libLogging;

export function useFactorioVersion(slave_id) {
	let control = useContext(ControlContext);
	let [data, setData] = useState({ loading: true, versions: [{ version: "latest" }] });

	function updateVersions() {
		libLink.messages.listFactorioVersions.send(control, {
			slave_id: slave_id || null,
		}).then(result => {
			setData({ loading: false, versions: [{ version: "latest" }, ...result.versions] });
		}).catch(error => {
			logger.error(`Error loading Factorio versions: ${error}`);
			setData({ loading: false, versions: [{ version: "latest" }] });
		});
	}

	useEffect(() => {
		updateVersions();
	}, [slave_id]);

	return [data, updateVersions];
}
