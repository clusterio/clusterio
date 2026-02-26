import { useEffect, useContext, useState } from "react";

import * as lib from "@clusterio/lib";
import ControlContext from "../components/ControlContext";

let exportManifestCache: lib.ExportManifest|null = null;
let loaded = false;
export function useExportManifest(): lib.ExportManifest|null {
	const control = useContext(ControlContext);
	let [exportManifest, setExportManifest] = useState<lib.ExportManifest|null>(exportManifestCache);
	useEffect(() => {
		async function load() {
			let modPack = await control.send(new lib.ModPackGetDefaultRequest());
			if (modPack.exportManifest) {
				exportManifestCache = modPack.exportManifest;
				setExportManifest(exportManifestCache);
			}
			loaded = true;
		}

		if (!loaded) {
			load();
		}
	}, []);

	return exportManifest;
}
