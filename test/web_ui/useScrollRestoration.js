import assert from "node:assert/strict";

import {
	ScrollRestorer, loadScrollPositions, restoreScroll, saveScrollPositions, scrollKey, setScrollPosition,
} from "../../packages/web_ui/src/util/useScrollRestoration.ts";

class MemoryStorage {
	items = new Map();
	getItem(key) { return this.items.get(key) ?? null; }
	setItem(key, value) { this.items.set(key, String(value)); }
}

class FakeWindow {
	scrollY = 0;
	maxScroll = 0;
	listeners = new Map();
	history = { scrollRestoration: "auto" };
	scrollTo(_x, y) {
		this.scrollY = Math.max(0, Math.min(y, this.maxScroll));
		this.emit("scroll");
	}

	addEventListener(type, listener) {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type).add(listener);
	}

	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
	}

	emit(type) {
		for (const listener of [...this.listeners.get(type) ?? []]) {
			listener();
		}
	}

	count(type) {
		return this.listeners.get(type)?.size ?? 0;
	}
}

class FakeResizeObserver {
	static observers = new Set();
	constructor(callback) { this.callback = callback; }
	observe() { FakeResizeObserver.observers.add(this); }
	disconnect() { FakeResizeObserver.observers.delete(this); }
}

function resize(maxScroll) {
	window.maxScroll = maxScroll;
	for (const observer of [...FakeResizeObserver.observers]) {
		observer.callback();
	}
}

function withDom() {
	beforeEach(function() {
		FakeResizeObserver.observers.clear();
		globalThis.window = new FakeWindow();
		globalThis.document = { body: {} };
		globalThis.sessionStorage = new MemoryStorage();
		globalThis.ResizeObserver = FakeResizeObserver;
	});
	afterEach(function() {
		delete globalThis.window;
		delete globalThis.document;
		delete globalThis.sessionStorage;
		delete globalThis.ResizeObserver;
	});
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
	describe("restoreScroll()", function() {
		withDom();

		it("should scroll immediately when the page is tall enough", function() {
			window.maxScroll = 2000;
			let done = 0;
			restoreScroll(1500, () => { done += 1; });
			assert.equal(window.scrollY, 1500);
			assert.equal(done, 1);
			assert.equal(FakeResizeObserver.observers.size, 0);
			assert.equal(window.count("wheel"), 0);
		});
		it("should retry as the page grows", function() {
			let done = 0;
			restoreScroll(1500, () => { done += 1; });
			assert.equal(window.scrollY, 0);
			resize(800);
			assert.equal(window.scrollY, 800);
			assert.equal(done, 0);
			resize(3000);
			assert.equal(window.scrollY, 1500);
			assert.equal(done, 1);
		});
		it("should give up when the user scrolls", function() {
			let done = 0;
			restoreScroll(1500, () => { done += 1; });
			window.emit("wheel");
			assert.equal(done, 1);
			resize(3000);
			assert.equal(window.scrollY, 0);
		});
		it("should give up after the timeout", function() {
			const realSetTimeout = globalThis.setTimeout;
			let fire;
			globalThis.setTimeout = (callback, ms) => {
				assert.equal(ms, 5000);
				fire = callback;
				return 0;
			};
			let done = 0;
			try {
				restoreScroll(1500, () => { done += 1; });
			} finally {
				globalThis.setTimeout = realSetTimeout;
			}
			fire();
			assert.equal(done, 1);
			resize(3000);
			assert.equal(window.scrollY, 0);
		});
		it("should stop only once when cancelled", function() {
			let done = 0;
			const stop = restoreScroll(1500, () => { done += 1; });
			stop();
			stop();
			assert.equal(done, 1);
		});
	});
	describe("class ScrollRestorer", function() {
		withDom();

		it("should record scroll positions per key and persist them", function() {
			const restorer = new ScrollRestorer("a", "/users");
			const detach = restorer.attach();
			assert.equal(window.history.scrollRestoration, "manual");
			window.maxScroll = 2000;
			window.scrollTo(0, 700);
			window.emit("pagehide");
			assert.deepEqual([...loadScrollPositions(sessionStorage)], [["a", 700]]);
			window.scrollTo(0, 900);
			detach();
			assert.deepEqual([...loadScrollPositions(sessionStorage)], [["a", 900]]);
			assert.equal(window.count("scroll"), 0);
			assert.equal(window.count("pagehide"), 0);
		});
		it("should scroll to the top when pushing another path", function() {
			const restorer = new ScrollRestorer("a", "/users");
			restorer.attach();
			window.maxScroll = 2000;
			window.scrollTo(0, 1500);
			restorer.navigate("b", "/users/x/view", "PUSH");
			assert.equal(window.scrollY, 0);
			assert.deepEqual([...loadScrollPositions(sessionStorage)], [["a", 1500]]);
		});
		it("should keep the position when only the query changes", function() {
			const restorer = new ScrollRestorer("a", "/users");
			restorer.attach();
			window.maxScroll = 2000;
			window.scrollTo(0, 1500);
			restorer.navigate("b", "/users", "PUSH");
			assert.equal(window.scrollY, 1500);
			assert.equal(restorer.positions.get("b"), 1500);
			restorer.navigate("c", "/users", "REPLACE");
			assert.equal(restorer.positions.get("c"), 1500);
		});
		it("should restore the saved position on pop", function() {
			saveScrollPositions(sessionStorage, new Map([["a", 1500], ["b", 0]]));
			const restorer = new ScrollRestorer("b", "/users/x/view");
			restorer.attach();
			window.maxScroll = 2000;
			window.scrollTo(0, 400);
			assert.equal(restorer.positions.get("b"), 400);
			restorer.navigate("a", "/users", "POP");
			assert.equal(window.scrollY, 1500);
			restorer.navigate("b", "/users/x/view", "POP");
			assert.equal(window.scrollY, 400);
			restorer.navigate("unknown", "/hosts", "POP");
			assert.equal(window.scrollY, 0);
		});
		it("should not record positions while restoring", function() {
			saveScrollPositions(sessionStorage, new Map([["a", 1500]]));
			const restorer = new ScrollRestorer("a", "/users");
			restorer.attach();
			const cancel = restorer.navigate("a", "/users", "POP");
			resize(600);
			assert.equal(window.scrollY, 600);
			assert.equal(restorer.positions.get("a"), 1500);
			cancel();
			window.scrollTo(0, 300);
			assert.equal(restorer.positions.get("a"), 300);
		});
	});
});
