import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";
import { useAccount } from "./account";

export function useHost(id?: number) {
	const [hosts, synced, error] = useHosts();
	return [id !== undefined ? hosts.get(id) : undefined, synced, error] as const;
}

export function useHosts() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.hosts.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.hosts.getSnapshot());
}

/** Requests from host installers waiting to be approved, empty if the account may not approve hosts */
export function useHostPairings() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const permitted = Boolean(account.hasPermission("core.host.approve"));
	const subscribe = useCallback(
		(callback: () => void) => (permitted ? control.hostPairings.subscribe(callback) : () => {}),
		[control, permitted],
	);
	return useSyncExternalStore(subscribe, () => control.hostPairings.getSnapshot());
}
