import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import { libLink, libLogging } from "@clusterio/lib";
const { logger } = libLogging;

export function useFactorioVersion() {
	let control = useContext(ControlContext);
	let [data, setData] = useState({ loading: true, versions: ["latest"] });

	function updateVersions() {
		libLink.messages.listFactorioVersions.send(control).then(result => {
			setData({ loading: false, versions: ["latest", ...result.versions.map(version => version.version)] });
		}).catch(error => {
			logger.error(`Error loading Factorio versions: ${error}`);
			setData({ loading: false, versions: ["latest"] });
		});
	}

	useEffect(() => {
		updateVersions();
	}, []);

	return [data, updateVersions];
}
