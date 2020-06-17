"use strict";
const assert = require("assert").strict;
const path = require("path");

const factorio = require("lib/factorio");


describe("lib/factorio/export", function() {
	describe("exportLocale()", function() {
		let testServer;
		before(async function() {
			let writePath = path.join("temp", "test", "server");
			testServer = new factorio.FactorioServer(path.join("test", "file", "factorio"), writePath, {});
			await testServer.init();
		});

		it("returns a flattened mapping with locale definitions", async function() {
			let locale = await factorio._exportLocale(testServer, new Map(), ["base"], "en");
			assert.deepEqual(locale, new Map([["test.key-a", "1"], ["test.key-b", "2"]]));
		});
	});
});
