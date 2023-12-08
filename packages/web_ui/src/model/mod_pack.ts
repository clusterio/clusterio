import { useContext, useEffect, useState } from "react";

import * as lib from "@clusterio/lib";

import ControlContext from "../components/ControlContext";

const { logger } = lib;


export type StateLoadStatus = {
	loading?: boolean;
	present?: boolean;
	missing?: boolean;
};

export function useModPack(id: number) {
	let control = useContext(ControlContext);
	let [modPack, setModPack] = useState<lib.ModPack|StateLoadStatus>({ loading: true });

	function updateModPack() {
		control.send(new lib.ModPackGetRequest(id)).then(updatedModPack => {
			setModPack(updatedModPack);
		}).catch(err => {
			logger.error(`Failed to get mod pack: ${err}`);
			setModPack({ missing: true });
		});
	}

	useEffect(() => {
		if (typeof id !== "number") {
			setModPack({ missing: true });
			return undefined;
		}
		updateModPack();

		function updateHandler(modPacks: lib.ModPack[]) {
			const newModPack = modPacks.find(m => m.id === id);
			if (newModPack) {
				setModPack(newModPack);
			}
		}
		control.modPackUpdate.subscribe(updateHandler);
		return () => {
			control.modPackUpdate.unsubscribe(updateHandler);
		};
	}, [id]);

	return [modPack];
}

export function useModPackList() {
	let control = useContext(ControlContext);
	let [modPackList, setModPackList] = useState<lib.ModPack[]>([]);

	function updateModPackList() {
		control.send(new lib.ModPackListRequest()).then(modPacks => {
			setModPackList(modPacks);
		}).catch(err => {
			logger.error(`Failed to list mod packs:\n${err}`);
		});
	}

	useEffect(() => {
		updateModPackList();

		function updateHandler(newModPacks: lib.ModPack[]) {
			setModPackList(oldList => {
				let newList = oldList.concat();
				for (const newModPack of newModPacks) {
					let index = newList.findIndex(u => u.id === newModPack.id);
					if (!newModPack.isDeleted) {
						if (index !== -1) {
							newList[index] = newModPack;
						} else {
							newList.push(newModPack);
						}
					} else if (index !== -1) {
						newList.splice(index, 1);
					}
				}
				return newList;
			});
		}

		control.modPackUpdate.subscribe(updateHandler);
		return () => {
			control.modPackUpdate.unsubscribe(updateHandler);
		};
	}, []);

	return [modPackList];

}
