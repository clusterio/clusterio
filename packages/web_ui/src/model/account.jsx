import { useContext, useEffect, useState } from "react";

import { notifyErrorHandler } from "../util/notify";
import ControlContext from "../components/ControlContext";

/**
 * @typedef {Object} Account
 * @property {?string} name - Name of the currently logged in account.
 * @property {?Array<object>} roles - Roles of the corrently logged in account.
 * @property {function(string)} hasPermission -
 *     Check if the currently logged in account has the given permission.
 * @property {function()} logOut - Logs out of the web interface.
 */

export function useAccount() {
	let control = useContext(ControlContext);
	let [name, setName] = useState(control.accountName);
	let [roles, setRoles] = useState(control.accountRoles);

	useEffect(() => {
		function onAccountUpdate(account) {
			setName(account.name);
			setRoles(account.roles);
		}
		control.onAccountUpdate(onAccountUpdate);
		return () => {
			control.offAccountUpdate(onAccountUpdate);
		};
	}, [control]);

	function hasPermission(permission) {
		for (let role of roles) {
			if (role.permissions.includes("core.admin") || role.permissions.includes(permission)) {
				return true;
			}
		}
		return false;
	}

	return {
		name,
		roles,
		hasPermission(permission) {
			if (!roles) {
				return null;
			}
			return hasPermission(permission);
		},
		hasAnyPermission(...permissions) {
			if (!roles) {
				return null;
			}
			for (let permission of permissions) {
				if (hasPermission(permission)) {
					return true;
				}
			}
			return false;
		},
		hasAllPermission(...permissions) {
			if (!roles) {
				return null;
			}
			for (let permission of permissions) {
				if (!hasPermission(permission)) {
					return false;
				}
			}
			return true;
		},
		logOut() {
			control.loggingOut = true;
			control.shutdown(notifyErrorHandler("Error logging out"));
		},
	};
}
