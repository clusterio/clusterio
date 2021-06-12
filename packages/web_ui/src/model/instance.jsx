import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import libLink from "@clusterio/lib/link";
import { logger } from "@clusterio/lib/logging";


export function useInstance(id) {
	let control = useContext(ControlContext);
	let [instance, setInstance] = useState({ loading: true });

	function updateInstance() {
		libLink.messages.getInstance.send(control, { id }).then(result => {
			setInstance({ ...result, present: true });
		}).catch(err => {
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

		function updateHandler(newInstance) {
			setInstance({ ...newInstance, present: true });
		}

		control.onInstanceUpdate(id, updateHandler);
		return () => {
			control.offInstanceUpdate(id, updateHandler);
		};
	}, [id]);

	return [instance, updateInstance];
}

export function useInstanceList() {
	let control = useContext(ControlContext);
	let [instanceList, setInstanceList] = useState([]);

	function updateInstanceList() {
		libLink.messages.listInstances.send(control).then(result => {
			setInstanceList(result.list);
		}).catch(err => {
			logger.error(`Failed to list instances:\n${err}`);
		});
	}

	useEffect(() => {
		updateInstanceList();

		function updateHandler(newInstance) {
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

		control.onInstanceUpdate(null, updateHandler);
		return () => {
			control.offInstanceUpdate(null, updateHandler);
		};
	}, []);

	return [instanceList];
}
