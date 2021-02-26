import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import libLink from "@clusterio/lib/link";


export function useSlave(id) {
	let control = useContext(ControlContext);
	let [slave, setSlave] = useState({ loading: true });

	function updateSlave() {
		if (!Number.isInteger(id)) {
			setSlave({ missing: true });
			return;
		}

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
		updateSlave();
	}, [id]);

	return [slave, updateSlave];
}
