import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import { libLink } from "@clusterio/lib";


export function useSlave(id) {
	let control = useContext(ControlContext);
	let [slave, setSlave] = useState({ loading: true });

	function updateSlave() {
		// XXX optimize by requesting only the slave in question
		libLink.messages.listSlaves.send(control).then(result => {
			let match = result.list.find(i => i.id === id);
			if (!match) {
				setSlave({ missing: true });
			} else {
				setSlave({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		if (!Number.isInteger(id)) {
			setSlave({ missing: true });
			return undefined;
		}
		updateSlave();

		function updateHandler(newSlave) {
			setSlave({ ...newSlave, present: true });
		}

		control.onSlaveUpdate(id, updateHandler);
		return () => {
			control.offSlaveUpdate(id, updateHandler);
		};
	}, [id]);

	return [slave, updateSlave];
}

export function useSlaveList() {
	let control = useContext(ControlContext);
	let [slaveList, setSlaveList] = useState([]);

	function updateSlaveList() {
		libLink.messages.listSlaves.send(control).then(result => {
			setSlaveList(result.list);
		});
	}

	useEffect(() => {
		updateSlaveList();

		function updateHandler(newSlave) {
			setSlaveList(oldList => {
				let newList = oldList.concat();
				let index = newList.findIndex(s => s.id === newSlave.id);
				if (index !== -1) {
					newList[index] = newSlave;
				} else {
					newList.push(newSlave);
				}
				return newList;
			});
		}

		control.onSlaveUpdate(null, updateHandler);
		return () => {
			control.offSlaveUpdate(null, updateHandler);
		};
	}, []);


	return [slaveList];
}
