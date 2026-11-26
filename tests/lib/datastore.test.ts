import t from "tap";
import fs from "node:fs/promises";
import path from "node:path";
import * as lib from "@clusterio/lib";

type Value = { id: number, name: string, updatedAtMs: number, isDeleted: boolean };

function value(id: number, name = `v${id}`, updatedAtMs = 0): Value {
	return { id, name, updatedAtMs, isDeleted: false };
}

// Provider that records calls and lets a test control save
class RecordingProvider extends lib.MemoryDatastoreProvider<string, number> {
	saves: Map<string, number>[] = [];
	loads = 0;
	async save(data: Map<string, number>) {
		this.saves.push(new Map(data));
		await super.save(data);
	}

	async load() {
		this.loads += 1;
		return await super.load();
	}
}

async function readJson(file: string) {
	return JSON.parse(await fs.readFile(file, "utf8"));
}

async function backups(dir: string) {
	return (await fs.readdir(dir)).filter(name => name.endsWith(".bak"));
}

// Silence the verbose Saving and Loading messages
t.capture(lib.logger, "verbose");

t.test("MemoryDatastoreProvider", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to an empty map", async t3 => {
			t3.strictSame(await new lib.MemoryDatastoreProvider().load(), new Map());
		});
		t2.test("uses the given map", async t3 => {
			const provider = new lib.MemoryDatastoreProvider(new Map([["a", 1]]));
			t3.strictSame(await provider.load(), new Map([["a", 1]]));
		});
	});
	t1.test("save()", async t2 => {
		t2.test("stores a copy of the data", async t3 => {
			const provider = new lib.MemoryDatastoreProvider<string, number>();
			const data = new Map([["a", 1]]);
			await provider.save(data);
			data.set("b", 2);
			t3.strictSame(await provider.load(), new Map([["a", 1]]));
		});
	});
	t1.test("load()", async t2 => {
		t2.test("returns a copy of the stored data", async t3 => {
			const provider = new lib.MemoryDatastoreProvider(new Map([["a", 1]]));
			const loaded = await provider.load();
			loaded.set("b", 2);
			t3.strictSame(await provider.load(), new Map([["a", 1]]));
		});
	});
});

t.test("JsonDatastoreProvider", async t1 => {
	t1.test("save()", async t2 => {
		t2.test("writes an object keyed by the map keys", async t3 => {
			const file = path.join(t3.testdir(), "data.json");
			const provider = new lib.JsonDatastoreProvider<Value, Value>(file);
			await provider.save(new Map([["a", value(1)], ["b", value(2)]]));
			t3.strictSame(await readJson(file), { a: value(1), b: value(2) });
		});
	});
	t1.test("load()", async t2 => {
		t2.test("returns an empty map when the file does not exist", async t3 => {
			const provider = new lib.JsonDatastoreProvider(path.join(t3.testdir(), "missing.json"));
			t3.strictSame(await provider.load(), new Map());
		});
		t2.test("reads back what save wrote", async t3 => {
			const file = path.join(t3.testdir(), "data.json");
			const provider = new lib.JsonDatastoreProvider<Value, Value>(file);
			const data = new Map([["a", value(1)], ["b", value(2)]]);
			await provider.save(data);
			t3.strictSame(await provider.load(), data);
		});
		t2.test("rejects invalid JSON", async t3 => {
			const dir = t3.testdir({ "data.json": "{ invalid" });
			const provider = new lib.JsonDatastoreProvider(path.join(dir, "data.json"));
			await t3.rejects(provider.load(), SyntaxError);
		});
		t2.test("rejects read errors other than a missing file", async t3 => {
			const dir = t3.testdir({ "data.json": {} });
			const provider = new lib.JsonDatastoreProvider(path.join(dir, "data.json"));
			await t3.rejects(provider.load(), { code: "EISDIR" });
		});
		t2.test("applies migrations, fromJson and finalise in order", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify({ a: 1, b: 2 }) });
			const calls: string[] = [];
			const provider = new lib.JsonDatastoreProvider<{ n: number }, number>(
				path.join(dir, "data.json"),
				json => { calls.push(`fromJson ${json}`); return { n: json }; },
				raw => { calls.push("migrations"); return { ...raw as Record<string, number>, c: 3 }; },
				(obj, map) => { calls.push(`finalise ${obj.n} ${map.size}`); return { n: obj.n * 10 }; },
			);
			t3.strictSame(await provider.load(), new Map([["a", { n: 10 }], ["b", { n: 20 }], ["c", { n: 30 }]]));
			t3.strictSame(calls, [
				"migrations",
				"fromJson 1", "finalise 1 0",
				"fromJson 2", "finalise 2 1",
				"fromJson 3", "finalise 3 2",
			]);
		});
		t2.test("writes a backup when finalise drops entries", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify({ a: 1, b: 2 }) });
			const file = path.join(dir, "data.json");
			t3.intercept(Date, "now", { value: () => 1234 });
			const warnings = t3.capture(lib.logger, "warn");
			const provider = new lib.JsonDatastoreProvider<number, number>(
				file, undefined, undefined, obj => (obj === 2 ? undefined : obj),
			);
			t3.strictSame(await provider.load(), new Map([["a", 1]]));
			t3.strictSame(await backups(dir), ["data.json.1234.bak"]);
			t3.strictSame(await readJson(`${file}.1234.bak`), { a: 1, b: 2 });
			t3.match(warnings()[0].args[0], `Duplicates detected in ${file}`);
		});
		t2.test("does not write a backup when nothing is dropped", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify({ a: 1 }) });
			await new lib.JsonDatastoreProvider(path.join(dir, "data.json")).load();
			t3.strictSame(await backups(dir), []);
		});
	});
});

t.test("JsonIdDatastoreProvider", async t1 => {
	t1.test("save()", async t2 => {
		t2.test("writes an array of the values", async t3 => {
			const file = path.join(t3.testdir(), "data.json");
			const provider = new lib.JsonIdDatastoreProvider<Value, Value>(file);
			await provider.save(new Map([[1, value(1)], [2, value(2)]]));
			t3.strictSame(await readJson(file), [value(1), value(2)]);
		});
	});
	t1.test("load()", async t2 => {
		t2.test("returns an empty map when the file does not exist", async t3 => {
			const provider = new lib.JsonIdDatastoreProvider(path.join(t3.testdir(), "missing.json"));
			t3.strictSame(await provider.load(), new Map());
		});
		t2.test("reads back what save wrote, keyed by id", async t3 => {
			const file = path.join(t3.testdir(), "data.json");
			const provider = new lib.JsonIdDatastoreProvider<Value, Value>(file);
			const data = new Map([[1, value(1)], [2, value(2)]]);
			await provider.save(data);
			t3.strictSame(await provider.load(), data);
		});
		t2.test("rejects invalid JSON", async t3 => {
			const dir = t3.testdir({ "data.json": "[ invalid" });
			const provider = new lib.JsonIdDatastoreProvider(path.join(dir, "data.json"));
			await t3.rejects(provider.load(), SyntaxError);
		});
		t2.test("rejects read errors other than a missing file", async t3 => {
			const dir = t3.testdir({ "data.json": {} });
			const provider = new lib.JsonIdDatastoreProvider(path.join(dir, "data.json"));
			await t3.rejects(provider.load(), { code: "EISDIR" });
		});
		t2.test("applies migrations, fromJson and finalise in order", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify([1, 2]) });
			const calls: string[] = [];
			const provider = new lib.JsonIdDatastoreProvider<{ id: number }, number>(
				path.join(dir, "data.json"),
				json => { calls.push(`fromJson ${json}`); return { id: json }; },
				raw => { calls.push("migrations"); return [...raw as number[], 3]; },
				(obj, map) => { calls.push(`finalise ${obj.id} ${map.size}`); return { id: obj.id * 10 }; },
			);
			t3.strictSame(await provider.load(), new Map([[10, { id: 10 }], [20, { id: 20 }], [30, { id: 30 }]]));
			t3.strictSame(calls, [
				"migrations",
				"fromJson 1", "finalise 1 0",
				"fromJson 2", "finalise 2 1",
				"fromJson 3", "finalise 3 2",
			]);
		});
		t2.test("writes a backup when ids are duplicated", async t3 => {
			const raw = [value(1, "first"), value(1, "second"), value(2)];
			const dir = t3.testdir({ "data.json": JSON.stringify(raw) });
			const file = path.join(dir, "data.json");
			t3.intercept(Date, "now", { value: () => 1234 });
			const warnings = t3.capture(lib.logger, "warn");
			const provider = new lib.JsonIdDatastoreProvider<Value, Value>(file);
			t3.strictSame(await provider.load(), new Map([[1, value(1, "second")], [2, value(2)]]));
			t3.strictSame(await backups(dir), ["data.json.1234.bak"]);
			t3.strictSame(await readJson(`${file}.1234.bak`), raw);
			t3.equal(warnings().length, 1);
		});
		t2.test("writes a backup when finalise drops entries", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify([value(1), value(2)]) });
			t3.capture(lib.logger, "warn");
			const provider = new lib.JsonIdDatastoreProvider<Value, Value>(
				path.join(dir, "data.json"), undefined, undefined, obj => (obj.id === 2 ? undefined : obj),
			);
			t3.strictSame([...(await provider.load()).keys()], [1]);
			t3.equal((await backups(dir)).length, 1);
		});
		t2.test("does not write a backup when nothing is dropped", async t3 => {
			const dir = t3.testdir({ "data.json": JSON.stringify([value(1)]) });
			await new lib.JsonIdDatastoreProvider(path.join(dir, "data.json")).load();
			t3.strictSame(await backups(dir), []);
		});
	});
});

t.test("Datastore", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to an empty memory store", async t3 => {
			const datastore = new lib.KeyValueDatastore<string, number>();
			t3.equal(datastore.size, 0);
			datastore.set("a", 1);
			await datastore.save();
			await datastore.load();
			t3.equal(datastore.get("a"), 1);
		});
		t2.test("uses the given data", async t3 => {
			const datastore = new lib.KeyValueDatastore(undefined, new Map([["a", 1]]));
			t3.equal(datastore.get("a"), 1);
		});
	});

	t1.test("getFilePath()", async t2 => {
		t2.test("resolves the file against the database directory", async t3 => {
			const config = new lib.ControllerConfig("controller");
			config.set("controller.database_directory", "databaseDir");
			t3.equal(lib.Datastore.getFilePath(config, "db.json"), path.resolve("databaseDir", "db.json"));
			t3.equal(
				lib.Datastore.getFilePath(config, path.join("foo", "db.json")),
				path.resolve("databaseDir", "foo", "db.json"),
			);
		});
	});

	t1.test("save()", async t2 => {
		t2.test("does not save when clean", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			await datastore.save();
			t3.equal(provider.saves.length, 0);
		});
		t2.test("saves once when dirty", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			datastore.set("a", 1);
			await datastore.save();
			await datastore.save();
			t3.strictSame(provider.saves, [new Map([["a", 1]])]);
		});
		t2.test("writes overlapping saves in order with the latest data", async t3 => {
			const provider = new RecordingProvider();
			let release!: () => void;
			const blocked = new Promise<void>(resolve => { release = resolve; });
			const save = provider.save.bind(provider);
			provider.save = async data => {
				const snapshot = new Map(data);
				if (!provider.saves.length) {
					await blocked;
				}
				await save(snapshot);
			};
			const datastore = new lib.KeyValueDatastore(provider);
			datastore.set("a", 1);
			const first = datastore.save();
			await new Promise(resolve => setImmediate(resolve));
			datastore.set("b", 2);
			const second = datastore.save();
			release();
			await Promise.all([first, second]);
			t3.strictSame(provider.saves, [new Map([["a", 1]]), new Map([["a", 1], ["b", 2]])]);
		});
		t2.test("saves again after a failed save", async t3 => {
			const provider = new RecordingProvider();
			const save = provider.save.bind(provider);
			let fail = true;
			provider.save = async data => {
				if (fail) {
					fail = false;
					throw new Error("disk full");
				}
				await save(data);
			};
			const datastore = new lib.KeyValueDatastore(provider);
			datastore.set("a", 1);
			await t3.rejects(datastore.save(), new Error("disk full"));
			await datastore.save();
			t3.strictSame(provider.saves, [new Map([["a", 1]])]);
		});
	});

	t1.test("load()", async t2 => {
		t2.test("replaces the data with the provider's", async t3 => {
			const provider = new RecordingProvider(new Map([["b", 2]]));
			const datastore = new lib.KeyValueDatastore(provider, new Map([["a", 1]]));
			await datastore.load();
			t3.strictSame([...datastore], [["b", 2]]);
			t3.equal(provider.loads, 1);
		});
		t2.test("clears the dirty flag", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			datastore.set("a", 1);
			await datastore.load();
			await datastore.save();
			t3.equal(provider.saves.length, 0);
		});
	});

	t1.test("accessors", async t2 => {
		const data = () => new Map([["a", { n: 1 }], ["b", { n: 2 }]]);
		t2.test("has() reports whether a key exists", async t3 => {
			const datastore = new lib.KeyValueDatastore(undefined, data());
			t3.equal(datastore.has("a"), true);
			t3.equal(datastore.has("c"), false);
		});
		t2.test("get() and getMutable() return the stored object or undefined", async t3 => {
			const map = data();
			const datastore = new lib.KeyValueDatastore(undefined, map);
			t3.equal(datastore.get("a"), map.get("a"));
			t3.equal(datastore.getMutable("a"), map.get("a"));
			t3.equal(datastore.get("c"), undefined);
			t3.equal(datastore.getMutable("c"), undefined);
		});
		t2.test("size counts the entries", async t3 => {
			t3.equal(new lib.KeyValueDatastore(undefined, data()).size, 2);
		});
		t2.test("iterates entries, values and keys", async t3 => {
			const map = data();
			const datastore = new lib.KeyValueDatastore(undefined, map);
			t3.strictSame([...datastore], [...map]);
			t3.strictSame([...datastore.values()], [...map.values()]);
			t3.strictSame([...datastore.valuesMutable()], [...map.values()]);
			t3.strictSame([...datastore.keys()], ["a", "b"]);
		});
	});
});

t.test("KeyValueDatastore", async t1 => {
	function track(datastore: lib.KeyValueDatastore<string, number>) {
		const events: unknown[] = [];
		datastore.on("update", updates => events.push(updates));
		return events;
	}

	t1.test("fromProvider()", async t2 => {
		t2.test("loads data from the provider", async t3 => {
			const provider = new RecordingProvider(new Map([["a", 1]]));
			const datastore = await lib.KeyValueDatastore.fromProvider(provider);
			t3.ok(datastore instanceof lib.KeyValueDatastore);
			t3.strictSame([...datastore], [["a", 1]]);
		});
		t2.test("saves to the same provider", async t3 => {
			const provider = new RecordingProvider();
			const datastore = await lib.KeyValueDatastore.fromProvider(provider);
			datastore.set("a", 1);
			await datastore.save();
			t3.strictSame(provider.saves, [new Map([["a", 1]])]);
		});
	});

	t1.test("set()", async t2 => {
		t2.test("stores the value and emits an update", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			const events = track(datastore);
			datastore.set("a", 1);
			t3.equal(datastore.get("a"), 1);
			t3.strictSame(events, [[["a", 1]]]);
			await datastore.save();
			t3.equal(provider.saves.length, 1);
		});
	});

	t1.test("setMany()", async t2 => {
		t2.test("stores all values and emits one update", async t3 => {
			const datastore = new lib.KeyValueDatastore<string, number>();
			const events = track(datastore);
			datastore.setMany([["a", 1], ["b", 2]]);
			t3.strictSame([...datastore], [["a", 1], ["b", 2]]);
			t3.strictSame(events, [[["a", 1], ["b", 2]]]);
		});
		t2.test("does nothing for an empty list", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			const events = track(datastore);
			datastore.setMany([]);
			await datastore.save();
			t3.strictSame(events, []);
			t3.equal(provider.saves.length, 0);
		});
	});

	t1.test("delete()", async t2 => {
		t2.test("removes the value and emits a deletion", async t3 => {
			const datastore = new lib.KeyValueDatastore(undefined, new Map([["a", 1]]));
			const events = track(datastore);
			datastore.delete("a");
			t3.equal(datastore.has("a"), false);
			t3.strictSame(events, [[["a", 1, true]]]);
		});
		t2.test("does nothing for a missing key", async t3 => {
			const provider = new RecordingProvider();
			const datastore = new lib.KeyValueDatastore(provider);
			const events = track(datastore);
			datastore.delete("a");
			await datastore.save();
			t3.strictSame(events, []);
			t3.equal(provider.saves.length, 0);
		});
	});

	t1.test("deleteMany()", async t2 => {
		t2.test("removes the values and emits one update", async t3 => {
			const datastore = new lib.KeyValueDatastore(undefined, new Map([["a", 1], ["b", 2], ["c", 3]]));
			const events = track(datastore);
			datastore.deleteMany(["a", "b"]);
			t3.strictSame([...datastore], [["c", 3]]);
			t3.strictSame(events, [[["a", 1, true], ["b", 2, true]]]);
		});
		t2.test("does nothing for an empty list", async t3 => {
			const datastore = new lib.KeyValueDatastore<string, number>();
			const events = track(datastore);
			datastore.deleteMany([]);
			t3.strictSame(events, []);
		});
		t2.test("skips keys that are not present, like delete()", async t3 => {
			const datastore = new lib.KeyValueDatastore(undefined, new Map([["a", 1]]));
			const events = track(datastore);
			datastore.deleteMany(["a", "missing"]);
			t3.strictSame(events, [[["a", 1, true]]]);
		});
	});
});

t.test("SubscribableDatastore", async t1 => {
	function track(datastore: lib.SubscribableDatastore<Value>) {
		const events: Value[][] = [];
		datastore.on("update", updates => events.push(updates.map(v => ({ ...v }))));
		return events;
	}

	t1.test("constructor", async t2 => {
		t2.test("starts lastUpdatedAtMs at the newest value", async t3 => {
			const datastore = new lib.SubscribableDatastore(undefined, new Map([
				[1, value(1, "a", 100)], [2, value(2, "b", 300)], [3, value(3, "c", 200)],
			]));
			t3.equal(datastore.lastUpdatedAtMs, 300);
		});
		t2.test("ignores values with a non finite updatedAtMs", async t3 => {
			const datastore = new lib.SubscribableDatastore(undefined, new Map([
				[1, value(1, "a", 100)],
				[2, value(2, "b", NaN)],
				[3, value(3, "c", Infinity)],
				[4, { ...value(4), updatedAtMs: undefined as any }],
			]));
			t3.equal(datastore.lastUpdatedAtMs, 100);
		});
		t2.test("is 0 when empty", async t3 => {
			t3.equal(new lib.SubscribableDatastore().lastUpdatedAtMs, 0);
		});
	});

	t1.test("fromProvider()", async t2 => {
		t2.test("loads data and lastUpdatedAtMs from the provider", async t3 => {
			const provider = new lib.MemoryDatastoreProvider(new Map([[1, value(1, "a", 500)]]));
			const datastore = await lib.SubscribableDatastore.fromProvider(provider);
			t3.ok(datastore instanceof lib.SubscribableDatastore);
			t3.strictSame([...datastore.keys()], [1]);
			t3.equal(datastore.lastUpdatedAtMs, 500);
		});
	});

	t1.test("load()", async t2 => {
		t2.test("updates lastUpdatedAtMs from the loaded data", async t3 => {
			const provider = new lib.MemoryDatastoreProvider(new Map([[1, value(1, "a", 50)]]));
			const datastore = new lib.SubscribableDatastore(provider, new Map([[2, value(2, "b", 900)]]));
			t3.equal(datastore.lastUpdatedAtMs, 900);
			await datastore.load();
			t3.equal(datastore.lastUpdatedAtMs, 50);
			t3.strictSame([...datastore.keys()], [1]);
		});
	});

	t1.test("set()", async t2 => {
		t2.test("stores the value with the current time", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const datastore = new lib.SubscribableDatastore<Value>();
			const events = track(datastore);
			const v = value(1);
			datastore.set(v);
			t3.equal(datastore.get(1), v);
			t3.equal(v.updatedAtMs, 1000);
			t3.equal(datastore.lastUpdatedAtMs, 1000);
			t3.strictSame(events, [[value(1, "v1", 1000)]]);
		});
		t2.test("keeps updatedAtMs increasing when the clock does not move", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const datastore = new lib.SubscribableDatastore<Value>();
			const a = value(1);
			const b = value(2);
			datastore.set(a);
			datastore.set(b);
			t3.equal(a.updatedAtMs, 1000);
			t3.equal(b.updatedAtMs, 1001);
		});
		t2.test("keeps updatedAtMs increasing when the clock goes back", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const datastore = new lib.SubscribableDatastore(undefined, new Map([[1, value(1, "a", 5000)]]));
			const v = value(2);
			datastore.set(v);
			t3.equal(v.updatedAtMs, 5001);
		});
	});

	t1.test("setMany()", async t2 => {
		t2.test("stores all values with the same time and emits one update", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const datastore = new lib.SubscribableDatastore<Value>();
			const events = track(datastore);
			datastore.setMany([value(1), value(2)]);
			t3.strictSame([...datastore.keys()], [1, 2]);
			t3.strictSame(events, [[value(1, "v1", 1000), value(2, "v2", 1000)]]);
		});
	});

	t1.test("delete()", async t2 => {
		t2.test("removes the value and marks it deleted", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const v = value(1);
			const datastore = new lib.SubscribableDatastore(undefined, new Map([[1, v]]));
			const events = track(datastore);
			datastore.delete(v);
			t3.equal(datastore.has(1), false);
			t3.equal(v.isDeleted, true);
			t3.equal(v.updatedAtMs, 1000);
			t3.strictSame(events, [[{ ...value(1, "v1", 1000), isDeleted: true }]]);
		});
	});

	t1.test("deleteMany()", async t2 => {
		t2.test("removes all values and emits one update", async t3 => {
			t3.intercept(Date, "now", { value: () => 1000 });
			const a = value(1);
			const b = value(2);
			const datastore = new lib.SubscribableDatastore(undefined, new Map([[1, a], [2, b], [3, value(3)]]));
			const events = track(datastore);
			datastore.deleteMany([a, b]);
			t3.strictSame([...datastore.keys()], [3]);
			t3.equal(a.isDeleted && b.isDeleted, true);
			t3.equal(events.length, 1);
			t3.strictSame(events[0].map(v => v.updatedAtMs), [1000, 1000]);
		});
	});

	t1.test("save()", async t2 => {
		t2.test("saves values written with set", async t3 => {
			const provider = new lib.MemoryDatastoreProvider<number, Value>();
			const datastore = new lib.SubscribableDatastore(provider);
			datastore.set(value(1));
			await datastore.save();
			t3.strictSame([...(await provider.load()).keys()], [1]);
		});
	});
});
