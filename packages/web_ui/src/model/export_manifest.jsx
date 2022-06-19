import { useEffect, useState } from "react";


let exportManifestCache = null;
let emptyCache = {};
export function useExportManifest() {
	let [exportManifest, setExportManifest] = useState(exportManifestCache || emptyCache);
	useEffect(() => {
		async function load() {
			let response = await fetch(`${webRoot}api/export-manifest`);
			if (response.ok) {
				exportManifestCache = await response.json();
				setExportManifest(exportManifestCache);
			}
		}

		if (!exportManifestCache) {
			load();
		}
	}, []);

	return exportManifest;
}
