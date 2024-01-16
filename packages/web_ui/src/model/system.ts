import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useSystems() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.systems.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.systems.getSnapshot());
}
