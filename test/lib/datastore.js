"use strict";
const events = require("events");
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const fs = require("fs-extra");
const path = require("path");

class MockDatastoreProvider extends lib.DatastoreProvider {
	constructor() {
		super();
		this.methodCalls = [];
		this.value = new Map();
		this.methodCalls.push(["constructor"]);
	}

	async save(data) {
		this.methodCalls.push(["save", data]);
	}

	async load() {
		this.methodCalls.push(["load"]);
		return this.value;
	}
}

class MockDatastore extends lib.Datastore {
	getData() {
		return this.data; // Protected member
	}

	callTouch(updates = [0]) {
		this.touch(updates); // Protected method
	}
}

describe("lib/datastore", function() {
	const baseDir = path.join("temp", "test", "datastore");
	const testFiles = path.join("test", "file");
	before(async function() {
		await fs.emptyDir(baseDir);
	});

	describe("class DatastoreProvider", function() {
		let datastoreProvider;
		beforeEach(function() {
			datastoreProvider = new MockDatastoreProvider();
		});

		it("can be constructed", function() {
			assert.deepEqual(datastoreProvider.methodCalls[0], ["constructor"]);
		});

		it("can be bootstrapped", async function() {
			const rtn = await datastoreProvider.bootstrap();
			assert.equal(rtn[0], datastoreProvider);
			assert.equal(rtn[1], datastoreProvider.value);
			assert.deepEqual(datastoreProvider.methodCalls[1], ["load"]);
		});
	});

	describe("class MemoryDatastoreProvider", function() {
		let datastoreProvider, initialData;
		beforeEach(function() {
			initialData = new Map([
				["foo", "fooValue"], ["bar", "barValue"], ["baz", "bazValue"],
			]);
			datastoreProvider = new lib.MemoryDatastoreProvider(initialData);
		});

		describe("constructor", function() {
			it("has a default value", async function() {
				const [, value] = await new lib.MemoryDatastoreProvider().bootstrap();
				assert.notEqual(value, undefined);
				assert.notEqual(value, null);
			});
			it("can have a value given", async function() {
				const expectedValue = new Map([["foo", "bar"]]);
				const [, value] = await new lib.MemoryDatastoreProvider(expectedValue).bootstrap();
				assert.deepEqual(value, expectedValue);
			});
		});

		describe("save", function() {
			it("can save data", async function() {
				const newData = new Map([["foo2", "fooValue2"]]);
				await datastoreProvider.save(newData);
				const loadedData = await datastoreProvider.load();
				assert.deepEqual(loadedData, newData);
			});
		});

		describe("load", function() {
			it("can load data", async function() {
				const loadedData = await datastoreProvider.load();
				assert.deepEqual(loadedData, initialData);
			});
		});
	});

	describe("class JsonDatastoreProvider", function() {
		let datastoreProvider, initialData, dataPath;
		before(async function() {
			dataPath = path.join(baseDir, "data.json");
			initialData = Object.entries(JSON.parse(await fs.readFile(
				path.join(testFiles, "json", "load_map.json"), { encoding: "utf8" }
			)));
		});

		beforeEach(async function() {
			await fs.copy(path.join(testFiles, "json", "load_map.json"), dataPath);
			datastoreProvider = new lib.JsonDatastoreProvider(dataPath);
		});

		describe("constructor", function() {
			it("has default values", async function() {
				datastoreProvider = new lib.JsonDatastoreProvider(dataPath);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData));
			});
			it("can accept a fromJson method", async function() {
				datastoreProvider = new lib.JsonDatastoreProvider(
					dataPath,
					json => [json]
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData.map(([k, v]) => [k, [v]])));
			});
			it("can accept a migration method", async function() {
				datastoreProvider = new lib.JsonDatastoreProvider(
					dataPath,
					json => json, // Nop
					rawJson => ({ c: "foo", ...rawJson })
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map([...initialData, ["c", "foo"]]));
			});
			it("can accept a finalise method", async function() {
				datastoreProvider = new lib.JsonDatastoreProvider(
					dataPath,
					json => json, // Nop
					rawJson => rawJson, // Nop
					obj => [obj]
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData.map(([k, v]) => [k, [v]])));
			});
		});

		describe("save", function() {
			it("can save data", async function() {
				const newData = new Map([["foo", "bar"]]);
				await datastoreProvider.save(newData);
				const loadedData = await datastoreProvider.load();
				assert.deepEqual(loadedData, newData);
			});
		});

		describe("load", function() {
			it("can load data", async function() {
				const loadedData = await datastoreProvider.load();
				assert.deepEqual(loadedData, new Map(initialData));
			});
			it("has a default value", async function() {
				datastoreProvider = new lib.JsonDatastoreProvider(path.join(baseDir, "not_exists.json"));
				const loadedData = await datastoreProvider.load();
				assert.equal(loadedData.size, 0);
			});
		});
	});

	describe("class JsonIdDatastoreProvider", function() {
		let datastoreProvider, initialData, dataPath;
		before(async function() {
			dataPath = path.join(baseDir, "data.json");
			initialData = JSON.parse(await fs.readFile(
				path.join(testFiles, "json", "load_array_map.json"), { encoding: "utf8" }
			)).map(v => [v.id, v]);
		});

		beforeEach(async function() {
			await fs.copy(path.join(testFiles, "json", "load_array_map.json"), dataPath);
			datastoreProvider = new lib.JsonIdDatastoreProvider(dataPath);
		});

		describe("constructor", function() {
			it("has default values", async function() {
				datastoreProvider = new lib.JsonIdDatastoreProvider(dataPath);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData));
			});
			it("can accept a fromJson method", async function() {
				datastoreProvider = new lib.JsonIdDatastoreProvider(
					dataPath,
					json => ({...json, foo: true})
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData.map(v => ([v[0], {...v[1], foo: true}]))));
			});
			it("can accept a migration method", async function() {
				datastoreProvider = new lib.JsonIdDatastoreProvider(
					dataPath,
					json => json, // Nop
					rawJson => ([{ id: "c" }, ...rawJson])
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map([...initialData, ["c", { id: "c" }]]));
			});
			it("can accept a finalise method", async function() {
				datastoreProvider = new lib.JsonIdDatastoreProvider(
					dataPath,
					json => json, // Nop
					rawJson => rawJson, // Nop
					obj => ({...obj, foo: true})
				);

				const [, value] = await datastoreProvider.bootstrap();
				assert.deepEqual(value, new Map(initialData.map(v => ([v[0], {...v[1], foo: true}]))));
			});
		});

		describe("save", function() {
			it("can save data", async function() {
				const newData = new Map([["foo", { id: "foo" }]]);
				await datastoreProvider.save(newData);
				const loadedData = await datastoreProvider.load();
				assert.deepEqual(loadedData, newData);
			});
		});

		describe("load", function() {
			it("can load data", async function() {
				const loadedData = await datastoreProvider.load();
				assert.equal(loadedData.size, initialData.length);
				assert.deepEqual(loadedData, new Map(initialData));
			});
			it("has a default value", async function() {
				datastoreProvider = new lib.JsonIdDatastoreProvider(path.join(baseDir, "not_exists.json"));
				const loadedData = await datastoreProvider.load();
				assert.equal(loadedData.size, 0);
			});
		});
	});

	describe("class Datastore", function() {
		let datastoreProvider, datastore;
		beforeEach(function() {
			datastoreProvider = new MockDatastoreProvider();
			datastoreProvider.value = new Map([
				["foo", "fooValue"], ["bar", "barValue"], ["baz", "bazValue"],
			]);
			datastore = new MockDatastore(datastoreProvider, datastoreProvider.value);
		});

		describe("constructor", function() {
			it("has a default value", function() {
				datastore = new MockDatastore(datastoreProvider);
				assert.deepEqual(datastore.getData(), new Map());
			});
			it("accepts a starting value", function() {
				datastore = new MockDatastore(datastoreProvider, datastoreProvider.value);
				assert.deepEqual(datastore.getData(), datastoreProvider.value);
			});
			it("accepts the return of bootstrap", async function() {
				datastore = new MockDatastore(...await datastoreProvider.bootstrap());
				assert.deepEqual(datastore.getData(), datastoreProvider.value);
			});
		});

		describe("getFilePath", function() {
			it("returns the correct filepath", function() {
				const mockConfig = {
					get(field) {
						if (field === "controller.database_directory") {
							return "databaseDir";
						}
						throw new Error(`field ${field} not implemented`);
					},
				};

				assert.equal(
					lib.Datastore.getFilePath(mockConfig, "db1.json"),
					path.resolve("databaseDir", "db1.json")
				);
				assert.equal(
					lib.Datastore.getFilePath(mockConfig, "db2.txt"),
					path.resolve("databaseDir", "db2.txt")
				);
				assert.equal(
					lib.Datastore.getFilePath(mockConfig, path.join("foo", "db3.json")),
					path.resolve("databaseDir", "foo", "db3.json")
				);
			});
		});

		describe("save", function() {
			it("should not save when clean", async function() {
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 1);
			});
			it("should save when dirty", async function() {
				datastore.callTouch(); // Make the data dirty
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1], ["save", datastore.getData()]);
			});
			it("should not save multiple times", async function() {
				datastore.callTouch(); // Make the data dirty
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1], ["save", datastore.getData()]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
			});
		});

		describe("load", function() {
			it("should load new data", async function() {
				datastoreProvider.value = new Map();
				assert.notEqual(datastore.getData(), datastoreProvider.value);
				await datastore.load();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1], ["load"]);
				assert.deepEqual(datastore.getData(), datastoreProvider.value);
			});
			it("should not save after a load", async function() {
				datastore.callTouch(); // Make the data dirty
				await datastore.load();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1], ["load"]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
			});
		});

		describe("touch", function() {
			it("should emit update events", function() {
				const eventsRaised = [];
				datastore.on("update", updates => eventsRaised.push(updates));

				let updates = ["foo"];
				datastore.callTouch(updates);
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], updates);

				updates = ["foo", "bar"];
				datastore.callTouch(updates);
				assert.equal(eventsRaised.length, 2);
				assert.deepEqual(eventsRaised[1], updates);
			});
		});

		describe("has", function() {
			it("returns true correctly", function() {
				assert.equal(datastore.has("foo"), true);
				assert.equal(datastore.has("bar"), true);
				assert.equal(datastore.has("baz"), true);
			});
			it("returns false correctly", function() {
				assert.equal(datastore.has("missing1"), false);
				assert.equal(datastore.has("missing2"), false);
				assert.equal(datastore.has(1), false);
				assert.equal(datastore.has(2), false);
			});
		});

		describe("get", function() {
			it("returns the correct value", function() {
				assert.equal(datastore.get("foo"), "fooValue");
				assert.equal(datastore.get("bar"), "barValue");
				assert.equal(datastore.get("baz"), "bazValue");
			});
			it("returns undefined correctly", function() {
				assert.equal(datastore.get("missing1"), undefined);
				assert.equal(datastore.get("missing2"), undefined);
				assert.equal(datastore.get(1), undefined);
				assert.equal(datastore.get(2), undefined);
			});
		});

		describe("getMutable", function() {
			it("returns the correct value", function() {
				assert.equal(datastore.get("foo"), "fooValue");
				assert.equal(datastore.get("bar"), "barValue");
				assert.equal(datastore.get("baz"), "bazValue");
			});
			it("returns undefined correctly", function() {
				assert.equal(datastore.get("missing1"), undefined);
				assert.equal(datastore.get("missing2"), undefined);
				assert.equal(datastore.get(1), undefined);
				assert.equal(datastore.get(2), undefined);
			});
		});

		describe("values", function() {
			it("returns all values", function() {
				assert.deepEqual([...datastore.values()], [...datastoreProvider.value.values()]);
			});
		});

		describe("valuesMutable", function() {
			it("returns all values", function() {
				assert.deepEqual([...datastore.values()], [...datastoreProvider.value.values()]);
			});
		});
	});

	describe("class KeyValueDatastore", function() {
		let datastoreProvider, datastore, eventsRaised;
		beforeEach(function() {
			eventsRaised = [];
			datastoreProvider = new MockDatastoreProvider();
			datastoreProvider.value = new Map([
				["foo", "fooValue"], ["bar", "barValue"], ["baz", "bazValue"],
			]);
			datastore = new lib.KeyValueDatastore(datastoreProvider, datastoreProvider.value);
			datastore.on("update", updates => eventsRaised.push(updates));
		});

		describe("set", function() {
			it("can set a value", function() {
				datastore.set("test", "testValue");
				assert.equal(datastore.get("test"), "testValue");
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [["test", "testValue"]]);
			});
			it("allows saving after a value is set", async function() {
				datastore.set("test", "testValue");
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries(), ["test", "testValue"]])]
				);
			});
		});

		describe("setMany", function() {
			it("does not save with zero changes", async function() {
				datastore.setMany([]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 1);
			});
			it("can set many values at once", async function() {
				const updates = [["test1", "testValue1"], ["test2", "testValue2"]];
				datastore.setMany(updates);
				assert.equal(datastore.get("test1"), "testValue1");
				assert.equal(datastore.get("test2"), "testValue2");
				await datastore.save();
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], updates);
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries(), ...updates])]
				);
			});
		});

		describe("delete", function() {
			it("can delete a value", function() {
				datastore.delete("foo");
				assert.equal(datastore.get("foo"), undefined);
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [["foo", "fooValue", true]]);
			});
			it("allows saving after a value is deleted", async function() {
				datastore.delete("foo");
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries()].filter((v, k) => k !== "foo"))]
				);
			});
			it("does not break when the key does not exist", function() {
				datastore.delete("test");
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [["test", undefined, true]]);
			});
		});

		describe("deleteMany", function() {
			it("does not save with zero changes", async function() {
				datastore.deleteMany([]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 1);
			});
			it("can delete many values at once", async function() {
				const keys = ["foo", "bar"];
				datastore.deleteMany(keys);
				assert.equal(datastore.get("foo"), undefined);
				assert.equal(datastore.get("bar"), undefined);
				await datastore.save();
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [["foo", "fooValue", true], ["bar", "barValue", true]]);
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries()].filter((v, k) => !keys.includes(k)))]
				);
			});
		});
	});

	describe("class SubscribableDatastore", function() {
		let datastoreProvider, datastore, eventsRaised;
		beforeEach(function() {
			eventsRaised = [];
			datastoreProvider = new MockDatastoreProvider();
			datastoreProvider.value = new Map([
				["foo", {id: "foo"}], ["bar", {id: "bar"}], ["baz", {id: "baz"}],
			]);
			datastore = new lib.SubscribableDatastore(datastoreProvider, datastoreProvider.value);
			datastore.on("update", updates => eventsRaised.push(updates));
		});

		describe("set", function() {
			it("can set a value", function() {
				const value = { id: "test" };
				datastore.set(value);
				assert.equal(datastore.get(value.id), value);
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [value]);
			});
			it("allows saving after a value is set", async function() {
				const value = { id: "test" };
				datastore.set(value);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries(), [value.id, value]])]
				);
			});
			it("sets the updatedAtMs property", function() {
				const value = { id: "test" };
				datastore.set(value);
				assert.notEqual(value.updatedAtMs, undefined);
				assert(value.updatedAtMs > 0, "updatedAtMs greater than zero");
				const prev = value.updatedAtMs;
				datastore.set(value);
				assert(value.updatedAtMs > prev, "updatedAtMs must increase");
			});
		});

		describe("setMany", function() {
			it("does not save with zero changes", async function() {
				datastore.setMany([]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 1);
			});
			it("can set many values at once", async function() {
				const updates = [{ id: "test1" }, { id: "test2" }];
				datastore.setMany(updates);
				assert.equal(datastore.get(updates[0].id), updates[0]);
				assert.equal(datastore.get(updates[1].id), updates[1]);
				await datastore.save();
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], updates);
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries(), ...updates.map(v => [v.id, v])])]
				);
			});
			it("sets the updatedAtMs property", function() {
				const updates = [{ id: "test1" }, { id: "test2" }];
				datastore.setMany(updates);
				assert.notEqual(updates[0].updatedAtMs, undefined);
				assert.notEqual(updates[1].updatedAtMs, undefined);
				assert(updates[0].updatedAtMs > 0, "updatedAtMs greater than zero");
				assert(updates[1].updatedAtMs > 0, "updatedAtMs greater than zero");
				const prev = [updates[0].updatedAtMs, updates[1].updatedAtMs];
				datastore.setMany(updates);
				assert(updates[0].updatedAtMs > prev[0], "updatedAtMs must increase");
				assert(updates[1].updatedAtMs > prev[1], "updatedAtMs must increase");
			});
		});

		describe("delete", function() {
			it("can delete a value", function() {
				const value = datastore.get("foo");
				datastore.delete(value);
				assert.equal(datastore.get(value.id), undefined);
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [value]);
			});
			it("allows saving after a value is deleted", async function() {
				const value = datastore.get("foo");
				datastore.delete(value);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries()].filter((v, k) => k !== value.id))]
				);
			});
			it("does not break when the key does not exist", function() {
				const value = { id: "test" };
				datastore.delete(value);
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], [value]);
			});
			it("sets the updatedAtMs property", function() {
				const value = { id: "test" };
				datastore.delete(value);
				assert.notEqual(value.updatedAtMs, undefined);
				assert(value.updatedAtMs > 0, "updatedAtMs greater than zero");
			});
			it("sets the isDeleted property", function() {
				const value = { id: "test" };
				datastore.delete(value);
				assert.equal(value.isDeleted, true);
			});
		});

		describe("deleteMany", function() {
			it("does not save with zero changes", async function() {
				datastore.deleteMany([]);
				await datastore.save();
				assert.equal(datastoreProvider.methodCalls.length, 1);
			});
			it("can delete many values at once", async function() {
				const values = [{id: "foo"}, {id: "bar"}];
				datastore.deleteMany(values);
				assert.equal(datastore.get(values[0].id), undefined);
				assert.equal(datastore.get(values[1].id), undefined);
				await datastore.save();
				assert.equal(eventsRaised.length, 1);
				assert.deepEqual(eventsRaised[0], values);
				assert.equal(datastoreProvider.methodCalls.length, 2);
				assert.deepEqual(datastoreProvider.methodCalls[1],
					["save", new Map([...datastoreProvider.value.entries()]
						.filter((_, k) => !values.some(v => v.id === k)))]
				);
			});
			it("sets the updatedAtMs property", function() {
				const values = [{id: "foo"}, {id: "bar"}];
				datastore.deleteMany(values);
				assert.notEqual(values[0].updatedAtMs, undefined);
				assert.notEqual(values[1].updatedAtMs, undefined);
				assert(values[0].updatedAtMs > 0, "updatedAtMs greater than zero");
				assert(values[1].updatedAtMs > 0, "updatedAtMs greater than zero");
			});
			it("sets the isDeleted property", function() {
				const values = [{id: "foo"}, {id: "bar"}];
				datastore.deleteMany(values);
				assert.equal(values[0].isDeleted, true);
				assert.equal(values[1].isDeleted, true);
			});
		});
	});
});
