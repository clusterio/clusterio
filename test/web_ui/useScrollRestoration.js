import assert from "node:assert/strict";

import {
	loadScrollPositions, saveScrollPositions, scrollKey, setScrollPosition,
} from "../../packages/web_ui/src/util/useScrollRestoration.ts";

class MemoryStorage {
	items = new Map();
	getItem(key) { return this.items.get(key) ?? null; }
	setItem(key, value) { this.items.set(key, String(value)); }
}

describe("web_ui/util/useScrollRestoration", function() {
	describe("loadScrollPositions()", function() {
		it("should round trip through saveScrollPositions", function() {
			const storage = new MemoryStorage();
			saveScrollPositions(storage, new Map([["a", 10], ["b", 20.5]]));
			assert.deepEqual([...loadScrollPositions(storage)], [["a", 10], ["b", 20.5]]);
		});
		it("should return an empty map when nothing is stored", function() {
			assert.equal(loadScrollPositions(new MemoryStorage()).size, 0);
		});
		it("should ignore corrupt data", function() {
			const storage = new MemoryStorage();
			storage.setItem("scroll_positions", "{not json");
			assert.equal(loadScrollPositions(storage).size, 0);
			storage.setItem("scroll_positions", JSON.stringify({ a: 1 }));
			assert.equal(loadScrollPositions(storage).size, 0);
			storage.setItem("scroll_positions", JSON.stringify([["a", 1], ["b", "x"], [2, 3]]));
			assert.deepEqual([...loadScrollPositions(storage)], [["a", 1]]);
		});
	});
	describe("saveScrollPositions()", function() {
		it("should ignore storage errors", function() {
			saveScrollPositions({ setItem() { throw new Error("QuotaExceededError"); } }, new Map([["a", 1]]));
		});
	});
	describe("setScrollPosition()", function() {
		it("should move an updated key to the newest position", function() {
			const positions = new Map([["a", 1], ["b", 2]]);
			setScrollPosition(positions, "a", 3);
			assert.deepEqual([...positions], [["b", 2], ["a", 3]]);
		});
		it("should drop the oldest entries past 100", function() {
			const positions = new Map();
			for (let i = 0; i < 105; i++) {
				setScrollPosition(positions, `k${i}`, i);
			}
			assert.equal(positions.size, 100);
			assert.equal(positions.has("k4"), false);
			assert.equal(positions.get("k5"), 5);
			assert.equal(positions.get("k104"), 104);
		});
	});
	describe("scrollKey()", function() {
		it("should use the location key", function() {
			assert.equal(scrollKey({ key: "abc123", pathname: "/users", search: "" }), "abc123");
		});
		it("should fall back to the path for entries created outside the router", function() {
			assert.equal(scrollKey({ key: "default", pathname: "/users", search: "?q=a" }), "/users?q=a");
		});
	});
});
