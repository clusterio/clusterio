"use strict";
const assert = require("assert").strict;
const path = require("path");

const { FactorioServer } = require("@clusterio/host/dist/src/server");
const { _exportLocale } = require("@clusterio/host/dist/src/export");


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
			assert.deepEqual(locale, new Map([["test.key-a", "1"], ["test.key-b", "2"]]));
		});
	});
});
