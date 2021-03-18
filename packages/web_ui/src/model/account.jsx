import { useContext, useEffect, useState } from "react";

import { notifyErrorHandler } from "../util/notify";
import ControlContext from "../components/ControlContext";

/**
 * @typedef {Object} Account
 * @property {?string} name - Name of the currently logged in account.
 * @property {function()} logout - Logs out of the web interface.
 */

export function useAccount() {
	let control = useContext(ControlContext);
	let [name, setName] = useState(control.accountName);

	useEffect(() => {
		function onConnect(data) {
			setName(data.account.name);
		}
		function onClose() {
			setName(null);
		}
		control.connector.on("connect", onConnect);
		control.connector.on("close", onClose);
		return () => {
			control.connector.off("connect", onConnect);
			control.connector.off("close", onClose);
		};
	}, [control]);

	return {
		name,
		logOut() {
			control.loggingOut = true;
			control.shutdown(notifyErrorHandler("Error logging out"));
		},
	};
}
