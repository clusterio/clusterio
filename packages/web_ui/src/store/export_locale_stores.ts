import { ExportLocale, logger } from "@clusterio/lib";
import notify from "../util/notify";


interface ExportLocaleCacheEntry {
	callbacks: (() => void)[];
	localePath: string | undefined;
	data: Map<string, string>;
}

class ExportLocaleStore {
	cache = new Map<number, ExportLocaleCacheEntry>();
	_emptyMap = new Map();

	async loadLocale(modPackId: number, cacheEntry: ExportLocaleCacheEntry) {
		let response = await fetch(`${staticRoot}static/${cacheEntry.localePath}`);
		if (response.ok) {
			cacheEntry.data = new Map(await response.json() as ExportLocale);
			for (const callback of cacheEntry.callbacks) {
				callback();
			}
		} else {
			notify(
				`Failed to locale for mod pack ${modPackId}, server returned: ` +
				`${response.status} ${response.statusText}`
			);
		}
	}

	subscribe(modPackId: number | undefined, localePath: string | undefined, callback: () => void) {
		if (modPackId === undefined || !localePath) {
			return () => {};
		}

		let cacheEntry = this.cache.get(modPackId);
		if (!cacheEntry) {
			cacheEntry = {
				callbacks: [],
				localePath: undefined,
				data: new Map(),
			};
			this.cache.set(modPackId, cacheEntry);
		}
		if (cacheEntry.localePath !== localePath) {
			cacheEntry.localePath = localePath;
			this.loadLocale(modPackId, cacheEntry).catch(logger.error);
		}
		cacheEntry.callbacks.push(callback);
		return () => {
			const index = cacheEntry.callbacks.indexOf(callback);
			if (index !== -1) {
				cacheEntry.callbacks.splice(index, 1);
			}
		};
	}

	getSnapshot(modPackId: number | undefined): ReadonlyMap<string, string> {
		if (modPackId === undefined) {
			return this._emptyMap;
		}
		return this.cache.get(modPackId)?.data ?? this._emptyMap;
	}
}
export const exportLocaleStore = new ExportLocaleStore();
