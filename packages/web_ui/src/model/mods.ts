import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useMod(id?: string) {
	const [mods, synced] = useMods();
	return [id !== undefined ? mods.get(id) : undefined, synced] as const;
}

export function useMods() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.mods.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.mods.getSnapshot());
}
