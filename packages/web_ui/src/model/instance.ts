import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

const { logger } = lib;

export type InstanceState = Partial<lib.InstanceDetails> & {
	loading?: boolean,
	present?: boolean,
	missing?: boolean,
}

export function useInstance(id: number): [InstanceState, ()=>void] {
	let control = useContext(ControlContext);
	let [instance, setInstance] = useState<InstanceState>({ loading: true });

	function updateInstance() {
		control.send(new lib.InstanceDetailsGetRequest(id)).then(updatedInstance => {
			setInstance({ ...updatedInstance, present: true });
		}).catch((err: any) => {
			logger.error(`Failed to get instance: ${err}`);
			setInstance({ missing: true });
		});
	}

	useEffect(() => {
		if (!Number.isInteger(id)) {
			setInstance({ missing: true });
			return undefined;
		}
		updateInstance();

		function updateHandler(newInstance: lib.InstanceDetails) {
			if (newInstance.id !== id) {
				return;
			}
			setInstance({ ...newInstance, present: true });
		}

		control.instanceUpdate.subscribe(updateHandler);
		return () => {
			control.instanceUpdate.unsubscribe(updateHandler);
		};
	}, [id]);

	return [instance, updateInstance];
}

export function useInstanceList() {
	let control = useContext(ControlContext);
	let [instanceList, setInstanceList] = useState<lib.InstanceDetails[]>([]);

	function updateInstanceList() {
		control.send(new lib.InstanceDetailsListRequest()).then(instances => {
			setInstanceList(instances);
		}).catch(err => {
			logger.error(`Failed to list instances:\n${err}`);
		});
	}

	useEffect(() => {
		updateInstanceList();

		function updateHandler(newInstance: lib.InstanceDetails) {
			setInstanceList(oldList => {
				let newList = oldList.concat();
				let index = newList.findIndex(s => s.id === newInstance.id);
				if (newInstance.status !== "deleted") {
					if (index !== -1) {
						newList[index] = newInstance;
					} else {
						newList.push(newInstance);
					}
				} else if (index !== -1) {
					newList.splice(index, 1);
				}
				return newList;
			});
		}

		control.instanceUpdate.subscribe(updateHandler);
		return () => {
			control.instanceUpdate.unsubscribe(updateHandler);
		};
	}, []);

	return [instanceList];
}
