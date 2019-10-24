const assert = require("assert").strict;
const path = require("path");

const factorio = require("lib/factorio");


describe("Integration of lib/factorio/locale", function() {
	describe("getLocale()", function() {
		let locale;
		before(async function() {
			locale = await factorio.getLocale(path.join("factorio", "data"), "en");
		});

		it("returns a nested object with base game locale information", async function() {
			assert.equal(typeof locale, "object");
			assert.equal(locale["entity-name"]["fish"], "Fish");
			assert.equal(locale["entity-name"]["small-lamp"], "Lamp");
			let empty_keys = 0;
			Object.keys(locale).forEach(key => {
				// first level of the nested object is always an object
				assert.equal(typeof locale[key], "object");

				Object.keys(locale[key]).forEach(key2 => {
					// second level of the nested object is always a string, nearly always truthy
					if (!locale[key][key2]) {
						empty_keys++;
					}
					assert.equal(typeof locale[key][key2], "string");
				});

			});
			assert(empty_keys < 10, `Got unusually high amount (${empty_keys}) of empty keys`);
		});

		it("has some duplicate keys", async function() {
			let arrayOfKeys = [];
			// collect all keys in a single array
			Object.keys(locale).forEach(key => {
				arrayOfKeys.push(key);
				Object.keys(locale[key]).forEach(key2 => {
					arrayOfKeys.push(key2);
				});
			});

			// check for duplicates
			let duplicateKeys = [];
			let i = 0;
			arrayOfKeys.forEach(key => {
				let o = 0;
				arrayOfKeys.forEach(key2 => {
					if(i != o && key == key2){
						duplicateKeys.push(key);
					}
					o++
				});
				i++;
			});
			// we got 704 but this is a very unexact number
			assert(duplicateKeys.length > 10)
		});
	});
});
