import { useContext } from "react";

import { notifyErrorHandler } from "../util/notify";
import ControlContext from "../components/ControlContext";

/**
 * @typedef {Object} Account
 * @property {function()} logout - Logs out of the web interface.
 */

export function useAccount() {
	let control = useContext(ControlContext);

	return {
		logOut() {
			control.loggingOut = true;
			control.shutdown(notifyErrorHandler("Error logging out"));
		},
	};
}
