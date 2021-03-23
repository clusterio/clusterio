import React, { useEffect, useState } from "react";


let localeCache = null;
export function useLocale() {
	let [locale, setLocale] = useState(localeCache || new Map());
	useEffect(() => {
		async function load() {
			let response = await fetch(`${webRoot}export/locale.json`);
			if (response.ok) {
				let data = await response.json();
				localeCache = new Map(data);
				setLocale(localeCache);
			}
		}

		if (!localeCache) {
			load();
		}
	}, []);

	return locale;
}

