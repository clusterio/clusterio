import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

const { logger } = lib;

export function useSaves(instanceId?: number): lib.SaveDetails[] {
	let control = useContext(ControlContext);
	let [saves, setSaves] = useState<lib.SaveDetails[]>([]);

	function updateSaves() {
		control.sendTo({ instanceId:instanceId! }, new lib.InstanceListSavesRequest()).then(updatedSaves => {
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

		function updateHandler(data: lib.InstanceSaveListUpdateEvent) {
			setSaves(data.saves);
		}

		control.saveListUpdate.subscribeToChannel(instanceId!, updateHandler);
		return () => {
			control.saveListUpdate.unsubscribeFromChannel(instanceId!, updateHandler);
		};
	}, [instanceId]);

	return saves;
}
