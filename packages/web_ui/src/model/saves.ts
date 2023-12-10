import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

const { logger } = lib;

export function useSaves(instanceId?: number): lib.SaveDetails[] {
	let control = useContext(ControlContext);
	let [saves, setSaves] = useState<lib.SaveDetails[]>([]);

	function updateSaves() {
		control.sendTo("controller", new lib.InstanceSaveDetailsListRequest()).then(updatedSaves => {
			setSaves(updatedSaves.filter(save => save.instanceId === instanceId));
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

		function updateHandler(updates: lib.SaveDetails[]) {
			setSaves(oldList => {
				let newList = oldList.concat();
				for (const newSave of updates) {
					if (newSave.instanceId !== instanceId) {
						continue;
					}
					let index = newList.findIndex(s => s.id === newSave.id);
					if (!newSave.isDeleted) {
						if (index !== -1) {
							newList[index] = newSave;
						} else {
							newList.push(newSave);
						}
					} else if (index !== -1) {
						newList.splice(index, 1);
					}
				}
				return newList;
			});
		}

		control.saveListUpdate.subscribe(updateHandler);
		return () => {
			control.saveListUpdate.unsubscribe(updateHandler);
		};
	}, [instanceId]);

	return saves;
}
