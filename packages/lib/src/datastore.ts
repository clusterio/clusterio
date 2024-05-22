import fs from "fs-extra";

import { safeOutputFile } from "./file_ops";
import { SubscribableValue } from "./subscriptions";
import { EventEmitter } from "stream";
import { ControllerConfig } from "./config";
import path from "path";

type DatastoreKey = string | number;
type DatastoreValue = string | number | boolean | object;

// Abstract class which can provide saving and loading capabilities to a datastore
export abstract class DatastoreProvider<
	K extends DatastoreKey,
	V extends DatastoreValue,
> {
	abstract save(data: Map<K, V>): Promise<void>
	abstract load(): Promise<Map<K, V>>

	// Load data from the source and return it, this should be passed to the constructor of a datastore
	async bootstrap() {
		return [this, await this.load()] as const;
	}
}

// Store all data in memory, used as a default and should be avoided
export class MemoryDatastoreProvider<
	K extends DatastoreKey,
	V extends DatastoreValue,
> extends DatastoreProvider<K, V> {
	async save(data: Map<K, V>) {
	}

	async load() {
		return new Map();
	}
}

// Store all data within a json object file and validate the result against a schema
export class JsonDatastoreProvider<
	K extends DatastoreKey,
	V extends DatastoreValue,
	J, // Intermediate type returned from migrations
> extends DatastoreProvider<K, V> {
	constructor(
		private filePath: string,
		private fromJson: (json: J) => V,
		private migrations: (rawJson: Record<DatastoreKey, unknown>) => Record<DatastoreKey, J> = v => v as any,
		private finalise: (obj: V) => V = v => v,
	) {
		super();
	}

	// Save the data to the json file
	async save(data: Map<K, V>) {
		await safeOutputFile(this.filePath, JSON.stringify(Object.fromEntries(data), null, "\t"));
	}

	// Load the data from the json file
	async load() {
		// Read the raw json from the file
		let rawJson;
		try {
			rawJson = JSON.parse(await fs.readFile(this.filePath, { encoding: "utf8" }));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}

		// Apply migrations
		const serialized = this.migrations(rawJson);

		// Convert to data class objects
		return new Map(Object.entries(serialized).map(([k, v]) => [k, this.finalise(this.fromJson(v))]));
	}
}

// Store all data within a json array file where each element has a unique id
export class JsonIdDatastoreProvider<
	K extends DatastoreKey,
	V extends DatastoreValue & { id: K },
	J, // Intermediate type returned from migrations
> extends DatastoreProvider<K, V> {
	constructor(
		private filePath: string,
		private fromJson: (json: J) => V,
		private migrations: (rawJson: Array<unknown>) => Array<J> = v => v as any,
		private finalise: (obj: V) => V = v => v,
	) {
		super();
	}

	// Save the data to the json file
	async save(data: Map<K, V>) {
		await safeOutputFile(this.filePath, JSON.stringify([...data.values()], null, "\t"));
	}

	// Load the data from the json file
	async load() {
		// Read the raw json from the file
		let rawJson;
		try {
			rawJson = JSON.parse(await fs.readFile(this.filePath, { encoding: "utf8" }));
		} catch (err: any) {
			if (err.code !== "ENOENT") {
				throw err;
			}
			return new Map();
		}

		// Apply migrations
		const serialized = this.migrations(rawJson);

		// Convert to data class objects
		return new Map(serialized.map((e) => {
			const v = this.finalise(this.fromJson(e));
			return [v.id, v];
		}));
	}
}

// Implements a similar interface to a map
export abstract class BaseDatastore<
	K extends DatastoreKey,
	V extends DatastoreValue,
> extends EventEmitter {
	private dirty = false;

	constructor(
		private provider: DatastoreProvider<K, V> = new MemoryDatastoreProvider(),
		protected data = new Map<K, V>(),
	) {
		super();
	}

	// Get the file path based on the controller config
	static getFilePath(config: ControllerConfig, file: string) {
		return path.resolve(config.get("controller.database_directory"), file);
	}

	// Save the datastore to the provider
	async save() {
		if (this.dirty) {
			await this.provider.save(this.data);
			this.dirty = false;
		}
	}

	// Load the datastore from the provider
	async load() {
		this.data = await this.provider.load();
		this.dirty = false;
	}

	// Set the dirty flag and call update handlers
	protected touch(updates: any[]) {
		if (updates.length) {
			this.dirty = true;
			this.emit("update", updates);
		}
	}

	// Returns true if the datastore has the value, false otherwise
	has(key: K) {
		return this.data.has(key);
	}

	// Get a value from from the datastore
	get(key: K) {
		return this.data.get(key) as Readonly<V> ?? undefined;
	}

	// Get a mutable reference to a value in the datastore, call set after use
	getMutable(key: K) {
		return this.data.get(key);
	}

	// Returns all values in the datastore
	values() {
		return this.data.values() as IterableIterator<Readonly<V>>;
	}

	// Returns all values in the datastore as mutable references, call setMany after use
	valuesMutable() {
		return this.data.values();
	}
}

// General key value mapping which can be saved and loaded with the file system
export class Datastore<
	K extends DatastoreKey,
	V extends DatastoreValue,
> extends BaseDatastore<K, V> {
	// Set the value in the datastore, be careful of race conditions if you await any functions before calling set
	set(key: K, value: V) {
		this.data.set(key, value);
		this.touch([[key, value]]);
	}

	// Set many values at once from an array of key value pairs
	setMany(pairs: [K, V][]) {
		for (const [k, v] of pairs) {
			this.data.set(k, v);
		}
		this.touch(pairs);
	}

	// Delete a value in the datastore
	delete(key: K) {
		const value = this.data.get(key);
		this.data.delete(key);
		this.touch([[key, value!, true]]);
	}

	// Delete many values at once from an array of keys
	deleteMany(keys: K[]) {
		const updates = [] as [K, V, true][];
		for (const key of keys) {
			const value = this.data.get(key);
			updates.push([key, value!, true]);
			this.data.delete(key);
		}
		this.touch(updates);
	}
}

// A special implementation of the datastore to work directly with subscribable values
export class SubscribableDatastore<
	V extends SubscribableValue,
> extends BaseDatastore<V["id"], V> {
	// Set the value in the datastore, be careful of race conditions if you await any functions before calling set
	set(value: V) {
		this.data.set(value.id, value);
		this.touch([value]);
	}

	// Set many values at once from an array of key value pairs
	setMany(values: V[]) {
		const nowMs = Date.now();
		for (const value of values) {
			value.updatedAtMs = nowMs;
			this.data.set(value.id, value);
		}
		this.touch(values);
	}

	// Delete a value in the datastore
	delete(value: V) {
		this.data.delete(value.id);
		value.updatedAtMs = Date.now();
		value.isDeleted = true;
		this.touch([value]);
	}

	// Delete many values at once from an array of values
	deleteMany(values: V[]) {
		const nowMs = Date.now();
		for (const value of values) {
			value.isDeleted = true;
			value.updatedAtMs = nowMs;
			this.data.delete(value.id);
		}
		this.touch(values);
	}
}
