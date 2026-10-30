import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";
import { defaultModPackStore } from "../store/default_mod_pack_store";


export function useModPack(id?: number) {
	const [modPacks, synced, error] = useModPacks();
	return [id !== undefined ? modPacks.get(id) : undefined, synced, error] as const;
}

export function useModPacks() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.modPacks.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.modPacks.getSnapshot());
}

export function useDefaultModPack() {
	const control = useContext(ControlContext);
	const subscribe = useCallback(
		(callback: () => void) => defaultModPackStore.subscribe(control, callback), [control],
	);
	return useSyncExternalStore(subscribe, () => defaultModPackStore.getSnapshot());
}
