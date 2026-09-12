import assert from "node:assert/strict";
import path from "node:path";

import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import { _exportLocale } from "@clusterio/host/dist/node/src/export.js";


describe("host/src/export", function() {
	describe("exportLocale()", function() {
		let testServer;
		before(async function() {
			let writePath = path.join("temp", "test", "server");
			testServer = new FactorioServer(path.join("test", "file", "factorio"), writePath, {});
			await testServer.init();
		});

		it("returns a flattened mapping with locale definitions", async function() {
			let locale = await _exportLocale(testServer, new Map(), ["base"], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
				["test.base-a", "1"], ["test.base-b", "2"],
			]));
		});
		it("returns a filtered locale definitions based on mod order", async function() {
			let locale = await _exportLocale(testServer, new Map(), [], "en");
			assert.deepEqual(locale, new Map([
				["test.core-a", "1"], ["test.core-b", "2"],
			]));
		});
	});
});
