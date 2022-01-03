import { useEffect, useState } from "react";


let itemMetadataCache = null;
export function useItemMetadata() {
	let [itemMetadata, setItemMetadata] = useState(itemMetadataCache || new Map());
	useEffect(() => {
		async function load() {
			let response = await fetch(`${webRoot}export/item-metadata.json`);
			if (response.ok) {
				let data = await response.json();
				itemMetadataCache = new Map(data);
				let style = document.createElement("style");
				style.type = "text/css";
				document.head.appendChild(style);
				for (let [name, meta] of itemMetadataCache) {
					style.sheet.insertRule(
						`.item-${CSS.escape(name)} {
	background-image: url("${webRoot}export/item-spritesheet.png");
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
	}, []);

	return itemMetadata;
}

