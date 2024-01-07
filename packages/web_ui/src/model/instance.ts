import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useInstance(id?: number) {
	const [instances, synced] = useInstances();
	return [id !== undefined ? instances.get(id) : undefined, synced] as const;
}

export function useInstances() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.instances.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.instances.getSnapshot());
}
