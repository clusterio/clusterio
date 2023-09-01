import { useContext, useEffect, useState } from "react";

import * as lib from "@clusterio/lib";

import ControlContext from "../components/ControlContext";

const { logger } = lib;

export function useModList() {
	let control = useContext(ControlContext);
	let [modList, setModList] = useState<lib.ModInfo[]>([]);

	function updateModList() {
		control.send(new lib.ModListRequest()).then(mods => {
			setModList(mods);
		}).catch(err => {
			logger.error(`Failed to list mods:\n${err}`);
		});
	}

	useEffect(() => {
		updateModList();

		function updateHandler(newMod: lib.ModInfo) {
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

