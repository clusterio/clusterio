import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

const { logger } = lib;

export function useSaves(instanceId) {
	let control = useContext(ControlContext);
	let [saves, setSaves] = useState([]);

	function updateSaves() {
		control.sendTo({ instanceId }, new lib.InstanceListSavesRequest()).then(updatedSaves => {
			setSaves(updatedSaves);
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
			setSaves(data.saves);
		}

		control.onSaveListUpdate(instanceId, updateHandler);
		return () => {
			control.offSaveListUpdate(instanceId, updateHandler);
		};
	}, [instanceId]);

	return saves;
}
