import { useEffect, useState } from "react";

import { useExportManifest } from "./export_manifest";


type Metadata = {
	x: number;
	y: number;
	size: number;
	category: string;
	localised_name?: any[];
	path?: string;
};

const metadataCaches = new Map<string, Map<string, Metadata>>();
let cssInjected = false;

/**
 * Load the unified spritesheet metadata and inject CSS rules for every icon.
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
			if (
				!exportManifest
				|| !exportManifest.assets["metadata"]
				|| !exportManifest.assets["spritesheet"]
			) {
				return;
			}

			const response = await fetch(`${staticRoot}static/${exportManifest.assets["metadata"]}`);
			if (!response.ok) {
				return;
			}

			const data: [string, Metadata][] = await response.json();

			if (!cssInjected) {
				const sheetUrl = `${staticRoot}static/${exportManifest.assets["spritesheet"]}`;
				const style = document.createElement("style");
				document.head.appendChild(style);
				for (const [name, meta] of data) {
					style.sheet!.insertRule(`\
.${meta.category}-${CSS.escape(name)} {
	background-image: url("${sheetUrl}");
	background-repeat: no-repeat;
	background-position: -${meta.x}px -${meta.y}px;
	height: ${meta.size}px;
	width: ${meta.size}px;
}`
					);
				}
				cssInjected = true;
			}

			const cache = new Map<string, Metadata>();
			for (const [name, meta] of data) {
				if (meta.category === category) {
					cache.set(name, meta);
				}
			}
			metadataCaches.set(category, cache);
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
