"use strict";
const assert = require("assert").strict;
const path = require("path");

const factorio = require("lib/factorio");


describe("Integration of lib/factorio/export", function() {
	describe("exportLocale()", function() {
		it("returns a nested Map with base game locale information", async function() {
			let writePath = path.join("temp", "test", "server");
			let testServer = new factorio.FactorioServer("factorio", writePath, {});
			await testServer.init();

			let locale = await factorio._exportLocale(testServer, new Map(), ["base"], "en");

			assert(locale instanceof Map, "locale is not a map");
			assert.equal(locale.get("entity-name.fish"), "Fish");
			assert.equal(locale.get("entity-name.small-lamp"), "Lamp");
			let empty_keys = 0;
			for (let [key, value] of locale) {
				// key is always a string
				assert.equal(typeof key, "string");

				// Value is always a string, nearly always truthy
				if (!value) {
					empty_keys++;
				}
				assert.equal(typeof value, "string");
			}
			assert(empty_keys < 10, `Got unusually high amount (${empty_keys}) of empty keys`);
		});
	});
});
