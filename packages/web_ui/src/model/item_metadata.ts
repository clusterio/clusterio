import { useEffect, useState } from "react";

import { useExportManifest } from "./export_manifest";


type Metadata = {
	x: number;
	y: number;
	size: number;
	localised_name?: any[];
};

const metadataCaches = new Map<string, Map<string, Metadata>>();

/**
 * Load a spritesheet category and inject CSS rules for each icon.
 * CSS class name: `.{category}-{CSS.escape(name)}`
 * e.g. `.item-iron-plate`, `.recipe-iron-plate`, `.signal-signal-red`, `.planet-nauvis`
 */
function useSpriteMetadata(category: string): Map<string, Metadata> {
	const exportManifest = useExportManifest();
	const [metadata, setMetadata] = useState<Map<string, Metadata>>(
		metadataCaches.get(category) ?? new Map()
	);

	useEffect(() => {
		async function load() {
			const metaKey = `${category}-metadata`;
			const sheetKey = `${category}-spritesheet`;
			if (
				!exportManifest
				|| !exportManifest.assets[metaKey]
				|| !exportManifest.assets[sheetKey]
			) {
				return;
			}

			const response = await fetch(`${staticRoot}static/${exportManifest.assets[metaKey]}`);
			if (!response.ok) {
				return;
			}

			const data = await response.json();
			const cache: Map<string, Metadata> = new Map(data);
			metadataCaches.set(category, cache);

			const style = document.createElement("style");
			document.head.appendChild(style);
			for (const [name, meta] of cache) {
				style.sheet!.insertRule(`\
.${category}-${CSS.escape(name)} {
	background-image: url("${staticRoot}static/${exportManifest.assets[sheetKey]}");
	background-repeat: no-repeat;
	background-position: -${meta.x}px -${meta.y}px;
	height: ${meta.size}px;
	width: ${meta.size}px;
}`
				);
			}
			setMetadata(cache);
		}

		if (!metadataCaches.has(category)) {
			load();
		}
	}, [exportManifest]);

	return metadata;
}

export function useItemMetadata() { return useSpriteMetadata("item"); }
export function useRecipeMetadata() { return useSpriteMetadata("recipe"); }
export function useSignalMetadata() { return useSpriteMetadata("signal"); }
export function useTechnologyMetadata() { return useSpriteMetadata("technology"); }
export function usePlanetMetadata() { return useSpriteMetadata("planet"); }
export function useQualityMetadata() { return useSpriteMetadata("quality"); }
export function useEntityMetadata() { return useSpriteMetadata("entity"); }
export function useStaticMetadata() { return useSpriteMetadata("static"); }
