const assert = require("assert").strict;
const path = require("path");

const factorio = require("lib/factorio");


describe("lib/factorio/locale", function() {
	describe("getLocale()", function() {
		it("verifies types of the arguments", async function() {
			await assert.rejects(factorio.getLocale(1, "a"), new TypeError("dataDir must be a string"));
			await assert.rejects(factorio.getLocale("a", 1), new TypeError("languageCode must be a string"));
		});
		it("returns a nested object with locale definitions", async function() {
			let locale = await factorio.getLocale(path.join("test", "file", "factorio", "data"), "en");
			assert.deepEqual(locale, { test: { "key-a": "1", "key-b": "2" } });
		});
	});;
});
