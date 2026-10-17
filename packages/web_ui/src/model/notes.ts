import { useCallback, useContext, useSyncExternalStore } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

export function useNote(resourceType: string, resourceId?: string | number) {
	const [notes, synced] = useNotes();
	const note = resourceId !== undefined ? notes.get(lib.Note.idFor(resourceType, resourceId)) : undefined;
	return [note, synced] as const;
}

export function useNotes() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.notes.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.notes.getSnapshot());
}
