import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

describe("lib/PluginLoader", function() {
	let logger;
	let loader;
	beforeEach(function() {
		logger = { warnings: [], warn(msg) { this.warnings.push(msg); } };
		loader = new lib.PluginLoader(logger);
	});
	const infos = (...names) => names.map(name => ({ name }));

	it("should let a plugin await a plugin later in the list while loading", async function() {
		const apis = { b: { b: true } };
		await loader.load(infos("a", "b"), async ({ name }) => {
			if (name === "a") {
				apis.a = { gotB: await loader.waitFor("a", "b") };
			}
			return apis[name];
		});
		assert.deepEqual(apis.a, { gotB: { b: true } });
		assert.equal(await loader.waitFor("c", "a"), apis.a);
		assert.deepEqual(logger.warnings, []);
	});
	it("should resolve undefined with a warning once loading finishes without the plugin", async function() {
		const result = loader.waitFor("a", "b");
		await loader.load(infos("c"), async () => ({}));
		assert.equal(await result, undefined);
		assert.equal(await loader.waitFor("a", "d"), undefined);
		assert.deepEqual(logger.warnings, [
			"Plugin a waited for plugin b which is not loaded",
			"Plugin a waited for plugin d which is not loaded",
		]);
	});
	it("should resolve undefined with a warning on timeout", async function() {
		const result = loader.waitFor("a", "b", 10);
		const other = loader.waitFor("c", "b");
		assert.equal(await result, undefined);
		assert.deepEqual(logger.warnings, ["Plugin a timed out after 10ms waiting for plugin b"]);
		await loader.load(infos("b"), async () => "api");
		assert.equal(await other, "api");
	});
	it("should break a wait cycle with the timeout", async function() {
		const got = {};
		await loader.load(infos("a", "b"), async ({ name }) => {
			got[name] = await loader.waitFor(name, name === "a" ? "b" : "a", name === "a" ? 10 : 1000);
			return name;
		});
		assert.deepEqual(got, { a: undefined, b: "a" });
		assert.deepEqual(logger.warnings, ["Plugin a timed out after 10ms waiting for plugin b"]);
	});
	it("should finish loading the rest before throwing the first error in list order", async function() {
		const loaded = [];
		await assert.rejects(
			loader.load(infos("a", "b", "c"), async ({ name }) => {
				if (name === "a") {
					await new Promise(resolve => setTimeout(resolve, 10));
					throw new Error("a failed");
				}
				if (name === "b") {
					throw new Error("b failed");
				}
				loaded.push(name);
				return name;
			}),
			{ message: "a failed" },
		);
		assert.deepEqual(loaded, ["c"]);
		assert.equal(await loader.waitFor("x", "a"), undefined);
		assert.deepEqual(logger.warnings, ["Plugin x waited for plugin a which is not loaded"]);
	});
});
