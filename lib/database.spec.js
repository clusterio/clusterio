const assert = require("assert").strict;
const fs = require("fs-extra");

const database = require("lib/database");

describe("lib/database", function() {
	describe("mapToObject()", function() {
		it("should throw on non-string key", function() {
			assert.throws(
				() => database.mapToObject(new Map([[1, 1]])),
				new Error("Expected all keys to be string but got number")
			);
			assert.throws(
				() => database.mapToObject(new Map([[Symbol(), 1]])),
				new Error("Expected all keys to be string but got symbol")
			);
		});

		it("should throw convert a map to an object", function() {
			assert.deepEqual(
				database.mapToObject(new Map([['a', 1], ['b', true]])),
				{'a': 1, 'b': true}
			);
		});
	});

	describe("loadJsonAsMap()", function() {
		let badTypes = ['null', 'array', 'number', 'string', 'boolean'];

		for (let type of badTypes) {
			it(`should reject on ${type} JSON`, async function() {
				await assert.rejects(
					database.loadJsonAsMap(`test/json/${type}.json`),
					new Error(`Expected object but got ${type}`)
				);
			});
		}

		it("should work on empty object JSON", async function() {
			assert.deepEqual(
				await database.loadJsonAsMap('test/json/object.json'),
				new Map()
			);
		});

		it("should work on object JSON", async function() {
			assert.deepEqual(
				await database.loadJsonAsMap('test/json/load_map.json'),
				new Map([['a', 1], ['b', true]])
			);
		});

		it("should give an empty Map for non-existant file", async function() {
			assert.deepEqual(
				await database.loadJsonAsMap('test/json/does-not-exist'),
				new Map()
			);
		});
	});

	describe("saveMapAsJson()", function() {
		it("should save a mapping as JSON", async function() {
			let testFile = 'test/json/save_map.json';
			async function deleteTestFile() {
				try {
					await fs.unlink(testFile);
				} catch (err) {
					/* istanbul ignore if */
					if (err.code !== 'ENOENT') {
						throw err;
					}
				}
			}

			await deleteTestFile();
			await database.saveMapAsJson(
				testFile, new Map([['c', {}], ['d', "foo"]])
			);

			assert.equal(
				await fs.readFile(testFile, {encoding: 'utf-8'}),
				'{\n    "c": {},\n    "d": "foo"\n}'
			);
			await deleteTestFile();
		});
	});

	describe("class ItemDatabase", function() {
		describe("constructor()", function() {
			it("should create an empty database with no args", function() {
				let items = new database.ItemDatabase();
				assert.deepEqual(items._items, new Map());
			});

			it("should restore the passed serialized database", function() {
				let items = new database.ItemDatabase({'a': 1, 'b': 2});
				assert.deepEqual(items._items, new Map([['a', 1], ['b', 2]]));
			});

			it("should throw on invalid serialized database", function() {
				assert.throws(
					() => new database.ItemDatabase({'a': NaN}),
					new Error("count must be a number")
				);

				assert.throws(
					() => new database.ItemDatabase({'a': 'a'}),
					new Error("count must be a number")
				);
			});
		});

		describe(".serialize()", function() {
			it("should return a serialized database", function() {
				let items = new database.ItemDatabase({'a': 10});
				assert.deepEqual(items.serialize(), {'a': 10});
			});

			it("should remove zero count entries", function() {
				let items = new database.ItemDatabase({'a': 0});
				assert.deepEqual(items.serialize(), {});
			});
		});

		describe(".size", function() {
			it("should give an approximate size of the database", function() {
				let items = new database.ItemDatabase({'a': 10});
				assert.equal(items.size, 1);
			});
		});

		describe(".getItemCount()", function() {
			it("should return the count of the given item", function() {
				let items = new database.ItemDatabase({'a': 10});
				assert.equal(items.getItemCount('a'), 10);
			});

			it("should return zero if item does not exist", function() {
				let items = new database.ItemDatabase();
				assert.equal(items.getItemCount('b'), 0);
			});

			it("should throw on invalid name", function() {
				let items = new database.ItemDatabase();
				assert.throws(
					() => items.getItemCount(2),
					new Error("name must be a string")
				);
			});
		});

		describe(".addItem()", function() {
			it("should add a new item", function() {
				let items = new database.ItemDatabase();
				items.addItem('a', 10);
				assert.deepEqual(items._items, new Map([['a', 10]]));
			})

			it("should add an existing item", function() {
				let items = new database.ItemDatabase({'a': 10});
				items.addItem('a', 10);
				assert.deepEqual(items._items, new Map([['a', 20]]));
			})

			it("should throw on invalid name", function() {
				let items = new database.ItemDatabase();
				assert.throws(
					() => items.addItem(2, 10),
					new Error("name must be a string")
				);
			});

			it("should throw on invalid count", function() {
				let items = new database.ItemDatabase();
				assert.throws(
					() => items.addItem('a', NaN),
					new Error("count must be a number")
				);
			});
		});

		describe(".removeItem()", function() {
			it("should remove an existing item", function() {
				let items = new database.ItemDatabase({'a': 20});
				items.removeItem('a', 10);
				assert.deepEqual(items._items, new Map([['a', 10]]));
			})

			it("should turn a non-existing item negative", function() {
				let items = new database.ItemDatabase();
				items.removeItem('a', 10);
				assert.deepEqual(items._items, new Map([['a', -10]]));
			})

			it("should throw on invalid name", function() {
				let items = new database.ItemDatabase();
				assert.throws(
					() => items.removeItem(2, 10),
					new Error("name must be a string")
				);
			});

			it("should throw on invalid count", function() {
				let items = new database.ItemDatabase();
				assert.throws(
					() => items.removeItem('a', 'b'),
					new Error("count must be a number")
				);
			});
		});
	});
});
