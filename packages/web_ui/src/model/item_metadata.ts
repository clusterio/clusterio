import { useEffect, useState } from "react";

import { useExportManifest } from "./export_manifest";
import { ExportMetadata, ExportMetadataEntry } from "@clusterio/lib";


const metadataCaches = new Map<string, Map<string, ExportMetadataEntry>>();
let cssInjected = false;

/**
 * Load the unified spritesheet metadata and inject CSS rules for every icon.
 * CSS class name: `.{category}-{CSS.escape(name)}`
 * e.g. `.item-iron-plate`, `.recipe-iron-plate`, `.signal-signal-red`, `.planet-nauvis`
 */
function useSpriteMetadata(category: string): Map<string, ExportMetadataEntry> {
	const exportManifest = useExportManifest();
	const [metadata, setMetadata] = useState<Map<string, ExportMetadataEntry>>(
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

			const data: ExportMetadata = await response.json();

			if (!cssInjected) {
				const sheetUrl = `${staticRoot}static/${exportManifest.assets["spritesheet"]}`;
				const style = document.createElement("style");
				document.head.appendChild(style);
				for (const [baseName, prototypes] of Object.entries(data)) {
					for (const prototype of prototypes) {
						const icon = prototype.icon;
						if (!icon) {
							continue;
						}
						style.sheet!.insertRule(`\
.${baseName}-${CSS.escape(prototype.name)} {
	background-image: url("${sheetUrl}");
	background-repeat: no-repeat;
	background-position: -${icon.x}px -${icon.y}px;
	height: ${icon.size}px;
	width: ${icon.size}px;
}`
						);
					}
				}
				cssInjected = true;
			}

			const cache = new Map<string, ExportMetadataEntry>();
			for (const prototype of data[category] ?? []) {
				cache.set(prototype.name, prototype);
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
export function useFluidMetadata() { return useSpriteMetadata("fluid"); }
export function useRecipeMetadata() { return useSpriteMetadata("recipe"); }
export function useVirtualSignalMetadata() { return useSpriteMetadata("virtual-signal"); }
export function useTechnologyMetadata() { return useSpriteMetadata("technology"); }
export function useSpaceLocationMetadata() { return useSpriteMetadata("space-location"); }
export function useQualityMetadata() { return useSpriteMetadata("quality"); }
export function useEntityMetadata() { return useSpriteMetadata("entity"); }
