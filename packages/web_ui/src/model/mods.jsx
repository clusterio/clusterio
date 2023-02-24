import { useContext, useEffect, useState } from "react";

import { libData, libLink, libLogging } from "@clusterio/lib";

import ControlContext from "../components/ControlContext";

const { logger } = libLogging;


export function useModList() {
	let control = useContext(ControlContext);
	let [modList, setModList] = useState([]);

	function updateModList() {
		libLink.messages.listMods.send(control).then(result => {
			setModList(result.list.map(mod => libData.ModInfo.fromJSON(mod)));
		}).catch(err => {
			logger.error(`Failed to list mods:\n${err}`);
		});
	}

	useEffect(() => {
		updateModList();

		function updateHandler(newMod) {
			setModList(oldList => {
				let newList = oldList.concat();
				let index = newList.findIndex(mod => mod.name === newMod.name && mod.version === newMod.version);
				if (!newMod.isDeleted) {
					if (index !== -1) {
						newList[index] = newMod;
					} else {
						newList.push(newMod);
					}
				} else if (index !== -1) {
					newList.splice(index, 1);
				}
				return newList;
			});
		}

		control.onModUpdate(null, updateHandler);
		return () => {
			control.offModUpdate(null, updateHandler);
		};
	}, []);

	return [modList];
}

