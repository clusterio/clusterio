import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useSavesOfInstance(instanceId?: number) {
	const [saves, synced] = useSaves();
	const savesOfInstance = new Map([...saves].filter(([_id, save]) => save.instanceId === instanceId));
	return [savesOfInstance, synced] as const;
}

export function useSaves() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.saves.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.saves.getSnapshot());
}
