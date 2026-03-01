import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

export function useRolesOfUser(user?: lib.UserDetails) {
	const [roles, synced] = useRoles();
	return [
		user !== undefined ? new Map([...user.roleIds].map(roleId => [roleId, roles.get(roleId)])) : new Map(),
		synced,
	] as const;
}

export function useRole(id?: number) {
	const [roles, synced] = useRoles();
	return [id !== undefined ? roles.get(id) : undefined, synced] as const;
}

export function useRoles() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.roles.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.roles.getSnapshot());
}
