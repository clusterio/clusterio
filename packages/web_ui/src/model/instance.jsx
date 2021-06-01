import React, { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import libLink from "@clusterio/lib/link";
import { logger } from "@clusterio/lib/logging";


export function useInstance(id) {
	let control = useContext(ControlContext);
	let [instance, setInstance] = useState({ loading: true });

	function updateInstance() {
		if (!Number.isInteger(id)) {
			setInstance({ missing: true });
			return;
		}

		libLink.messages.getInstance.send(control, { id }).then(result => {
			setInstance({ ...result, present: true });
		}).catch(err => {
			logger.log(`Failed to get instance: ${err}`);
			setInstance({ missing: true });
		});

	}

	useEffect(() => {
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
