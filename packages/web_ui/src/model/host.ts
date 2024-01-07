import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useHost(id?: number) {
	const [hosts, synced] = useHosts();
	return [id !== undefined ? hosts.get(id) : undefined, synced] as const;
}

export function useHosts() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.hosts.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.hosts.getSnapshot());
}
