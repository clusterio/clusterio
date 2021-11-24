import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import { libLink, libLogging } from "@clusterio/lib";
const { logger } = libLogging;


export function useSaves(instanceId) {
	let control = useContext(ControlContext);
	let [saves, setSaves] = useState([]);

	function updateSaves() {
		libLink.messages.listSaves.send(control, { instance_id: instanceId }).then(result => {
			setSaves(result.list);
		}).catch(err => {
			logger.error(`Failed to list instance saves: ${err}`);
			setSaves([]);
		});
	}

	useEffect(() => {
		if (!Number.isInteger(instanceId)) {
			setSaves([]);
			return undefined;
		}
		updateSaves();

		function updateHandler(data) {
			setSaves(data.list);
		}

		control.onSaveListUpdate(instanceId, updateHandler);
		return () => {
			control.offSaveListUpdate(instanceId, updateHandler);
		};
	}, [instanceId]);

	return saves;
}
