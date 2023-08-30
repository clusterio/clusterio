import { useEffect, useState } from "react";

import { useExportManifest } from "./export_manifest";


let itemMetadataCache = null;
export function useItemMetadata() {
	let exportManifest = useExportManifest();
	let [itemMetadata, setItemMetadata] = useState(itemMetadataCache || new Map());
	useEffect(() => {
		async function load() {
			if (
				!exportManifest
				|| !exportManifest.assets
				|| !exportManifest.assets["item-metadata"]
				|| !exportManifest.assets["item-spritesheet"]
			) {
				return;
			}
			let response = await fetch(`${staticRoot}static/${exportManifest.assets["item-metadata"]}`);
			if (response.ok) {
				let data = await response.json();
				itemMetadataCache = new Map(data);
				let style = document.createElement("style");
				style.type = "text/css";
				document.head.appendChild(style);
				for (let [name, meta] of itemMetadataCache) {
					style.sheet.insertRule(
						`.item-${CSS.escape(name)} {
	background-image: url("${staticRoot}static/${exportManifest.assets["item-spritesheet"]}");
	background-repeat: no-repeat;
	background-position: -${meta.x}px -${meta.y}px;
	height: ${meta.size}px;
	width: ${meta.size}px;
}`
					);
				}
				setItemMetadata(itemMetadataCache);
			}
		}

		if (!itemMetadataCache) {
			load();
		}
	}, [exportManifest]);

	return itemMetadata;
}

