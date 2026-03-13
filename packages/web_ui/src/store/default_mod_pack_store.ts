import { ModPackGetDefaultRequest, type ModPack, isDeepStrictEqual } from "@clusterio/lib";
import type { Control } from "../util/websocket";

// TODO: replace this super duper expensive method with listening to a default mod pack id event.
class DefaultModPackStore {
	refCount = 0;
	interval: undefined | ReturnType<typeof setInterval>;
	modPack: undefined | ModPack;
	callbacks: (() => void)[] = [];

	fetchDefaultModPack(control: Control) {
		control.send(new ModPackGetDefaultRequest()).then(modPack => {
			if (!isDeepStrictEqual(this.modPack, modPack)) {
				this.modPack = modPack;
				for (const callback of this.callbacks) {
					callback();
				}
			}
		}).catch(() => {
			if (this.modPack !== undefined) {
				this.modPack = undefined;
				for (const callback of this.callbacks) {
					callback();
				}
			}
		});
	}

	subscribe(control: Control, callback: () => void) {
		if (!this.refCount) {
			const update = () => { this.fetchDefaultModPack(control); };
			update();
			this.interval = setInterval(update, 60e3);
		}
		this.callbacks.push(callback);
		this.refCount += 1;
		return () => {
			this.callbacks.splice(this.callbacks.indexOf(callback), 1);
			this.refCount -= 1;
			if (!this.refCount) {
				clearInterval(this.interval);
				this.interval = undefined;
			}
		};
	}

	getSnapshot() {
		return this.modPack;
	}
};
export const defaultModPackStore = new DefaultModPackStore();
