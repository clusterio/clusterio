import React, { useEffect, useState } from "react";

import { useExportManifest } from "./export_manifest";


let localeCache = null;
export function useLocale() {
	let exportManifest = useExportManifest();
	let [locale, setLocale] = useState(localeCache || new Map());
	useEffect(() => {
		async function load() {
			if (!exportManifest || !exportManifest.assets["locale"]) {
				return;
			}
			let response = await fetch(`${staticRoot}static/${exportManifest.assets["locale"]}`);
			if (response.ok) {
				let data = await response.json();
				localeCache = new Map(data);
				setLocale(localeCache);
			}
		}

		if (!localeCache) {
			load();
		}
	}, [exportManifest]);

	return locale;
}

