import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useSystemMetrics() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.systemMetrics.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.systemMetrics.getSnapshot());
}
