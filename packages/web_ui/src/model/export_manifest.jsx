import { useEffect, useContext, useState } from "react";

import { libData } from "@clusterio/lib";
import ControlContext from "../components/ControlContext";


let exportManifestCache = null;
let emptyCache = {};
export function useExportManifest() {
	const control = useContext(ControlContext);
	let [exportManifest, setExportManifest] = useState(exportManifestCache || emptyCache);
	useEffect(() => {
		async function load() {
			let modPack = await control.send(new libData.ModPackGetDefaultRequest());
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
