import { useContext, useEffect, useState } from "react";
import * as lib from "@clusterio/lib";

import { notifyErrorHandler } from "../util/notify";
import ControlContext from "../components/ControlContext";


export function useAccount(): lib.UserAccount {
	let control = useContext(ControlContext);
	let [name, setName] = useState<string>(control.accountName || "");
	let [roles, setRoles] = useState<any[]>(control.accountRoles || []);

	useEffect(() => {
		function onAccountUpdate(account: lib.AccountDetails) {
			setName(account.name);
			setRoles(account.roles);
		}
		control.onAccountUpdate(onAccountUpdate);
		return () => {
			control.offAccountUpdate(onAccountUpdate);
		};
	}, [control]);

	function hasPermission(permission: string): boolean {
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
		hasPermission(permission: string): boolean | null {
			if (!roles) {
				return null;
			}
			return hasPermission(permission);
		},
		hasAnyPermission(...permissions: string[]): boolean | null {
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
		hasAllPermission(...permissions: string[]): boolean | null {
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
			notifyErrorHandler("Error logging out");
			control.shutdown();
		},
	};
}
