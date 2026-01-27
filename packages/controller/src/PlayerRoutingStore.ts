import fs from "fs-extra";

import * as lib from "@clusterio/lib";

export type StoredRoute = {
	name: string;
	instanceId: number;
	hostId: number;
	gamePort: number;
	timestampMs: number;
};

export default class PlayerRoutingStore {
	private _routes = new Map<string, StoredRoute>();
	private _dirty = false;

	constructor(private _filePath: string) {}

	get(name: string): StoredRoute | undefined {
		return this._routes.get(name.toLowerCase());
	}

	update(name: string, instanceId: number, hostId: number, gamePort: number, timestampMs: number) {
		const key = name.toLowerCase();
		this._routes.set(key, { name, instanceId, hostId, gamePort, timestampMs });
		this._dirty = true;
	}

	delete(name: string) {
		const key = name.toLowerCase();
		if (this._routes.delete(key)) {
			this._dirty = true;
		}
	}

	dropHost(hostId: number) {
		let removed = false;
		for (const [key, route] of this._routes) {
			if (route.hostId === hostId) {
				this._routes.delete(key);
				removed = true;
			}
		}
		if (removed) {
			this._dirty = true;
		}
	}

	async load(): Promise<void> {
		try {
			const routes = JSON.parse(await fs.readFile(this._filePath, { encoding: "utf8" })) as StoredRoute[];
			this._routes.clear();
			for (const route of routes) {
				if (!route || !route.name) {
					continue;
				}
				this._routes.set(route.name.toLowerCase(), route);
			}
			this._dirty = false;
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
	}

	async save(): Promise<void> {
		if (!this._dirty) {
			return;
		}
		const payload = JSON.stringify([...this._routes.values()], null, "\t");
		await lib.safeOutputFile(this._filePath, payload);
		this._dirty = false;
	}
}
