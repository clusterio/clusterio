import type { ModPack } from "@clusterio/lib";
import { useCallback, useSyncExternalStore } from "react";
import { exportLocaleStore } from "../store/export_locale_stores";


export function useExportLocale(modPack: ModPack | undefined) {
	const localePath = modPack?.exportManifest?.assets["locale"];
	const subscribe = useCallback(
		(callback: () => void) => exportLocaleStore.subscribe(modPack?.id, localePath, callback),
		[modPack?.id, localePath],
	);
	return useSyncExternalStore(subscribe, () => exportLocaleStore.getSnapshot(modPack?.id));
}
