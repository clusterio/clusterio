/**
 * Implementation of controller databases
 *
 * @module lib/database
 * @author Hornwitser
 */
import fs from "fs-extra";

import * as libFileOps from "./file_ops";
import { basicType } from "./helpers";


/**
 * Converts a Map with only string keys to a JavaScript object.
 *
 * @param map - the Map to convert to an object.
 * @return Object with the mapping's key-values as properties.
 * @throws {Error} if there are non-string keys in map.
 */
export function mapToObject<T>(map: Map<string, T>) {
	let obj: Record<string, T> = {};
	for (let [key, value] of map) {
		if (typeof key !== "string") {
			throw new Error(
				`Expected all keys to be string but got ${typeof key}`
			);
		}

		obj[key] = value;
	}
	return obj;
}

/**
 * Load JSON object file as a Map
 *
 * Loads the JSON file specified by path containing an object with
 * properties as key value pairs and converts it into a JavaScript Map.
 * Returns an empty Map if the file does not exist.
 *
 * @param filePath - The path to the JSON file to load.
 * @returns promise resolving to the loaded map
 * @throws {Error} If JSON file did not contain an object.
 * @throws {Error} If an error occured reading the file.
 */
export async function loadJsonAsMap(filePath: string): Promise<Map<string, unknown>> {
	try {
		let content = await fs.readFile(filePath);
		let parsed = JSON.parse(content.toString());

		if (basicType(parsed) !== "object") {
			throw new Error(`Expected object but got ${basicType(parsed)}`);
		}

		return new Map(Object.entries(parsed));

	} catch (err: any) {
		if (err.code === "ENOENT") {
			// File does not exist, return empty map
			return new Map();

		}
		throw err;
	}
}

/**
 * Save a Map as a JSON object file
 *
 * Save the content of a key-value Map with only string keys as a JSON file.
 * If the directory the file is to be saved into doesn't exist it will be
 * created.
 *
 * @param filePath - The path to the JSON file that will be saved.
 * @param map - Map with only string keys to save.
 * @throws {Error} if there are non-string keys in map.
 * @throws {Error} if an error occured writing to the file.
 */
export async function saveMapAsJson(filePath: string, map: Map<string, unknown>) {
	let obj = mapToObject(map);
	await libFileOps.safeOutputFile(filePath, JSON.stringify(obj, null, 4));
}

/**
 * Load JSON array file as a Map
 *
 * Loads the JSON file specified by path containing an array of objects that
 * each have an id property into a Map from the id to the object.
 *
 * @param filePath - The path to the JSON file to load.
 * @throws {Error} If JSON file did not contain an array.
 * @throws {Error} If there are objects in the array without an id property.
 * @throws {Error} If an error occured reading the file.
 */
export async function loadJsonArrayAsMap(filePath: string): Promise<Map<unknown, unknown>> {
	try {
		let content = await fs.readFile(filePath);
		let parsed = JSON.parse(content.toString());

		if (basicType(parsed) !== "array") {
			throw new Error(`Expected array but got ${basicType(parsed)}`);
		}

		let map = new Map();
		for (let element of parsed) {
			if (basicType(element) !== "object") {
				throw new Error("Expected all elements to be objects");
			}

			if (element.id === undefined) {
				throw new Error("Expected all elements to have an id property");
			}

			map.set(element.id, element);
		}
		return map;

	} catch (err: any) {
		if (err.code === "ENOENT") {
			// File does not exist, return empty map
			return new Map();

		}
		throw err;
	}
}

/**
 * Save a Map as a JSON array file
 *
 * Save the values of a Map with objects containing an id property that is
 * equal to the key the objects are stored at into a JSON file.
 *
 * @param filePath - The path to the JSON file that will be saved.
 * @param map -
 *     Map with objects containing an id property equal to the key they are
 *     stored under.
 * @throws {Error} if an error occured writing to the file.
 */
export async function saveMapAsJsonArray(filePath: string, map: Map<unknown, { id: unknown }>) {
	await libFileOps.safeOutputFile(filePath, JSON.stringify([...map.values()], null, 4));
}


function checkName(name: unknown): asserts name is string {
	if (typeof name !== "string") {
		throw new Error("name must be a string");
	}
}

function checkCount(count: unknown): asserts count is number {
	if (typeof count !== "number" || isNaN(count)) {
		throw new Error("count must be a number");
	}
}


/**
 * Item database
 *
 * Stores counts of items for the controller.  Items that have not been
 * stored in the database are treated as having a stored count of zero.  When
 * serialized the database discards entries with a zero counts, and when
 * deserialized the content is verified.
 */
export class ItemDatabase {
	private _items: Map<string, number> = new Map();

	/**
	 * Create a new item database
	 *
	 * @param {object|undefined} serialized - An object from a previous call to
	 *     {@link module:libbase~ItemDatabase#serialize} to restore the
	 *     database from.  An empty database will be created if this parameter
	 *     is left undefined.
	 */
	constructor(serialized?: object) {
		// Verify the content of the serialized database
		if (serialized !== undefined) {
			for (let [name, count] of Object.entries(serialized)) {
				checkName(name);
				checkCount(count);

				this._items.set(name, count);
			}
		}
	}

	/**
	 * Serialize item database
	 *
	 * Serialize the item database into a plain JavaScript object that can be
	 * turned inta a string with JSON.stringify().
	 *
	 * @returns Serialized representation of the database
	 */
	serialize() {
		let obj: Record<string, number> = {};
		for (let [name, count] of this._items) {
			if (count !== 0) {
				obj[name] = count;
			}
		}
		return obj;
	}

	/**
	 * Approximate size of the items database.
	 *
	 * Does not account for entries being zero in the item database.
	 */
	get size() {
		return this._items.size;
	}


	/**
	 * Get the count of an item stored in the database
	 *
	 * Returns the count of a given item that has been stored in to the
	 * database.  If the item has not been previously stored into the database
	 * then 0 is returned.
	 *
	 * @param name - The name of the item to get the count of.
	 * @returns The count of the item stored.
	 */
	getItemCount(name: string) {
		checkName(name);

		if (!this._items.has(name)) {
			return 0;
		}

		return this._items.get(name);
	}

	/**
	 * Adds count of an item to the database
	 *
	 * Add count copies of the item specified by name to the item database.
	 *
	 * @param name - The name of the item to add.
	 * @param count - The count of item to remove.
	 */
	addItem(name: string, count: number) {
		checkName(name);
		checkCount(count);

		if (this._items.has(name)) {
			count += this._items.get(name)!;
		}

		this._items.set(name, count);
	};

	/**
	 * Removes count of an item from the database.
	 *
	 * Remove count copies of the item specified by name from the item database
	 * If count is greater than the currently stored count the stored item
	 * count will become negative.
	 *
	 * @param name - The name of the item to remove.
	 * @param count - The count of items to remove.
	 */
	removeItem(name: string, count: number) {
		checkName(name);
		checkCount(count);

		count = -count;
		if (this._items.has(name)) {
			count += this._items.get(name)!;
		}

		this._items.set(name, count);
	};
}
