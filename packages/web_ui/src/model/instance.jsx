import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import libLink from "@clusterio/lib/link";


export function useInstance(id) {
	let control = useContext(ControlContext);
	let [instance, setInstance] = useState({ loading: true });

	function updateInstance() {
		if (!Number.isInteger(id)) {
			setInstance({ missing: true });
			return;
		}

		// XXX optimize by requesting only the instance in question
		libLink.messages.listInstances.send(control).then(result => {
			let match = result.list.find(i => i.id === id);
			if (!match) {
				setInstance({ missing: true });
			} else {
				setInstance({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		updateInstance();
	}, [id]);

	return [instance, updateInstance];
}
