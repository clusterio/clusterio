import fs from "fs-extra";

import { safeOutputFile } from "./file_ops";
import { SubscribableValue } from "./subscriptions";
import { JSONDeserialisable } from "./data/composites";
import { EventEmitter } from "stream";

type DatastoreKey = string | number;
type DatastoreValue = string | number | boolean | object;

// Deep copy required to support the read only property of datastore values
function deepCopy<V extends DatastoreValue>(value: V): V {
	if (value instanceof Object) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, deepCopy(v)])
		) as V;
	}

	return value;
}

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
> extends DatastoreProvider<K, V> {
	constructor(
		private filePath: string,
		private dataClass: JSONDeserialisable<V>,
		private migrations: (rawJson: unknown) => Array<[K, unknown]> = v => v as any,
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
		return new Map(serialized.map((k, v) => [k, this.dataClass.fromJSON(v)]));
	}
}

// Store all data within a json array file where each element has a unique id
export class JsonIdDatastoreProvider<
	K extends DatastoreKey,
	V extends DatastoreValue & { id: K },
> extends DatastoreProvider<K, V> {
	constructor(
		private filePath: string,
		private dataClass: JSONDeserialisable<V>,
		private migrations: (rawJson: unknown) => Array<{ id: K }> = v => v as any,
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
			const v = this.dataClass.fromJSON(e);
			return [v.id, v];
		}));
	}
}

// Implements a similar interface to a map
export abstract class BaseDatastore<
	K extends DatastoreKey,
	V extends DatastoreValue,
> extends EventEmitter {
	protected dirty = false;

	constructor(
		protected provider: DatastoreProvider<K, V> = new MemoryDatastoreProvider(),
		protected data = new Map<K, V>(),
	) {
		super();
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

	// Returns true if the datastore has the value, false otherwise
	has(key: K) {
		return this.data.has(key);
	}

	// Get a value from from the datastore
	get(key: K) {
		return this.data.get(key) as Readonly<V> ?? undefined;
	}

	// Get a copy of a value from the datastore
	getCopy(key: K) {
		// const v = this.data.get(key);
		// return v === undefined ? v : deepCopy(v);
		return this.data.get(key);
	}

	// Returns all values in the datastore
	values() {
		return this.data.values() as IterableIterator<Readonly<V>>;
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
		this.dirty = true;
		this.emit("update", [key, value]);
	}

	// Set many values at once from an array of key value pairs
	setMany(pairs: [K, V][]) {
		this.dirty ||= pairs.length > 0;
		for (const [k, v] of pairs) {
			this.data.set(k, v);
		}
		this.emit("update", pairs);
	}

	// Delete a value in the datastore
	delete(key: K) {
		const value = this.data.get(key);
		this.data.delete(key);
		this.dirty = true;
		this.emit("update", [key, value, true]);
	}

	// Delete many values at once from an array of keys
	deleteMany(keys: K[]) {
		this.dirty ||= keys.length > 0;
		for (const key of keys) {
			const value = this.data.get(key);
			this.data.delete(key);
		}
		this.emit("update", keys);
	}
}

// A special implementation of the datastore to work directly with subscribable values
// TODO broadcast value changes to subscribers
export class SubscribableDatastore<
	V extends SubscribableValue,
> extends BaseDatastore<V["id"], V> {
	// Set the value in the datastore, be careful of race conditions if you await any functions before calling set
	set(value: V) {
		value.updatedAtMs = Date.now();
		this.data.set(value.id, value);
		this.dirty = true;
		this.emit("update", [value]);
	}

	// Set many values at once from an array of key value pairs
	setMany(values: V[]) {
		const nowMs = Date.now();
		this.dirty ||= values.length > 0;
		for (const value of values) {
			value.updatedAtMs = nowMs;
			this.data.set(value.id, value);
		}
		this.emit("update", values);
	}

	// Delete a value in the datastore
	delete(value: V) {
		this.data.delete(value.id);
		value.isDeleted = true;
		value.updatedAtMs = Date.now();
		this.emit("update", [value]);
	}

	// Delete many values at once from an array of values
	deleteMany(values: V[]) {
		this.dirty ||= values.length > 0;
		for (const value of values) {
			value.isDeleted = true;
			value.updatedAtMs = Date.now();
			this.data.delete(value.id);
		}
		this.emit("update", values);
	}
}
