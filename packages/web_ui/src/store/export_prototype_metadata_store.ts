import { ExportMetadata, ExportMetadataEntry, logger, ModPack } from "@clusterio/lib";
import unknownIconUrl from "../images/unknown-item.png";
import notify from "../util/notify";


export type PrototypeMetadataEntry = ExportMetadataEntry & { base_type: string };

interface MetadataCacheEntry {
	callbacks: (() => void)[],
	metadataPath: string | undefined,
	spritesheetPath: string | undefined,
	metadata: Map<string, Map<string, PrototypeMetadataEntry>>,
	styleSheet: CSSStyleSheet,
}

class ExportPrototypeMetadataStore {
	cache = new Map<number, MetadataCacheEntry>();
	async loadMetadata(modPackId: number, cacheEntry: MetadataCacheEntry) {
		if (!cacheEntry.metadataPath) {
			// eslint-disable-next-line node/no-sync
			cacheEntry.styleSheet.replaceSync("");
			cacheEntry.metadata = new Map();
			for (const callback of cacheEntry.callbacks) {
				callback();
			}
			return;
		}

		const response = await fetch(`${staticRoot}static/${cacheEntry.metadataPath}`);
		if (!response.ok) {
			notify(
				`Failed to fetch prototype metadata for mod pack ${modPackId}, server returned: ` +
				`${response.status} ${response.statusText}`
			);
			// eslint-disable-next-line node/no-sync
			cacheEntry.styleSheet.replaceSync("");
			cacheEntry.metadata = new Map();
			for (const callback of cacheEntry.callbacks) {
				callback();
			}
			return;
		}

		const metadata = await response.json() as ExportMetadata;

		const spriteUrl = `${staticRoot}static/${cacheEntry.spritesheetPath}`;
		const styleContent: string[] = [];
		styleContent.push(`\
.factorio-icon\
[data-mod-pack="${modPackId}"] {
	background-image: url("${spriteUrl}");
}`);
		for (const [baseName, prototypes] of Object.entries(metadata)) {
			for (const prototype of prototypes) {
				const icon = prototype.icon;
				if (!icon) {
					styleContent.push(`\
.factorio-icon\
[data-mod-pack="${modPackId}"]\
[data-type="${baseName}"]\
[data-name="${CSS.escape(prototype.name)}"] {
	background-image: url("${unknownIconUrl}");
	height: 32px;
	width: 32px;
}`);
					continue;
				}
				styleContent.push(`\
.factorio-icon\
[data-mod-pack="${modPackId}"]\
[data-type="${baseName}"]\
[data-name="${CSS.escape(prototype.name)}"] {
	background-position: -${icon.x}px -${icon.y}px;
	height: ${icon.size}px;
	width: ${icon.size}px;
}`);
			}
		}

		// eslint-disable-next-line node/no-sync
		cacheEntry.styleSheet.replaceSync(styleContent.join("\n"));
		cacheEntry.metadata = new Map(
			Object.entries(metadata)
				.map(([baseName, entries]) => [
					baseName,
					new Map(
						entries.map(entry => [entry.name, { base_type: baseName, ...entry }])
					),
				])
		);
		for (const callback of cacheEntry.callbacks) {
			callback();
		}
	}

	subscribe(modPack: ModPack | undefined, callback: () => void) {
		if (!modPack) {
			return () => {};
		}

		const assets = modPack.exportManifest?.assets;
		let cacheEntry = this.cache.get(modPack.id);
		if (!cacheEntry) {
			const styleSheet = new CSSStyleSheet();
			document.adoptedStyleSheets.push(styleSheet);
			cacheEntry = {
				callbacks: [],
				spritesheetPath: undefined,
				metadataPath: undefined,
				metadata: new Map(),
				styleSheet,
			};
			this.cache.set(modPack.id, cacheEntry);
		}
		if (
			cacheEntry.metadataPath !== assets?.metadata
			|| cacheEntry.spritesheetPath !== assets?.spritesheet
		) {
			cacheEntry.metadataPath = assets?.metadata;
			cacheEntry.spritesheetPath = assets?.spritesheet;
			this.loadMetadata(modPack.id, cacheEntry).catch(logger.error);
		}
		cacheEntry.callbacks.push(callback);
		return () => {
			const index = cacheEntry.callbacks.indexOf(callback);
			if (index !== -1) {
				cacheEntry.callbacks.splice(index, 1);
			}
		};
	}

	getSnapshot(modPackId: number | undefined) {
		if (modPackId === undefined) {
			return undefined;
		}
		return this.cache.get(modPackId)?.metadata;
	}
}
export const exportPrototypeMetadataStore = new ExportPrototypeMetadataStore();
