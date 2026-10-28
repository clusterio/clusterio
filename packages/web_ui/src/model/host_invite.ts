import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

export function useHostInvites() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.hostInvites.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.hostInvites.getSnapshot());
}
