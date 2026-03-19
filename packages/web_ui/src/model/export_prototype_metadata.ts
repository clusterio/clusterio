import { useCallback, useSyncExternalStore } from "react";

import { ModPack } from "@clusterio/lib";
import { exportPrototypeMetadataStore } from "../store/export_prototype_metadata_store";


/**
 * Load the unified spritesheet metadata and inject CSS rules for every icon.
 * Required for {@link FactorioIcon}.
 */
export function useExportPrototypeMetadata(modPack: ModPack | undefined) {
	const subscribe = useCallback(
		(callback: () => void) => exportPrototypeMetadataStore.subscribe(modPack, callback),
		[modPack]
	);
	return useSyncExternalStore(subscribe, () => exportPrototypeMetadataStore.getSnapshot(modPack?.id));
}
