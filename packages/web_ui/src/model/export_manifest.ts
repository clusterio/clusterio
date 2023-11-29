import { useEffect, useContext, useState } from "react";

import * as lib from "@clusterio/lib";
import ControlContext from "../components/ControlContext";

let exportManifestCache: lib.ExportManifest|null = null;
let emptyCache = { assets: {} };
export function useExportManifest(): lib.ExportManifest|null {
	const control = useContext(ControlContext);
	let [exportManifest, setExportManifest] = useState<lib.ExportManifest|null>(exportManifestCache || emptyCache);
	useEffect(() => {
		async function load() {
			let modPack = await control.send(new lib.ModPackGetDefaultRequest());
			if (modPack.exportManifest) {
				exportManifestCache = modPack.exportManifest;
				setExportManifest(exportManifestCache);
			}
		}

		if (!exportManifestCache) {
			load();
		}
	}, []);

	return exportManifest;
}
