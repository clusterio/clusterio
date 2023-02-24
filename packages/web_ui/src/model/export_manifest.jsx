import { useEffect, useContext, useState } from "react";

import { libData, libLink } from "@clusterio/lib";
import ControlContext from "../components/ControlContext";


let exportManifestCache = null;
let emptyCache = {};
export function useExportManifest() {
	const control = useContext(ControlContext);
	let [exportManifest, setExportManifest] = useState(exportManifestCache || emptyCache);
	useEffect(() => {
		async function load() {
			let result = await libLink.messages.getDefaultModPack.send(control);
			let modPack = libData.ModPack.fromJSON(result.mod_pack);
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
