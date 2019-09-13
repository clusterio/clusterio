const assert = require("assert");
const util = require("util");

const getFactorioLocale = require("lib/getFactorioLocale");
const asObjectAsync = util.promisify(getFactorioLocale.asObject);

describe("getFactorioLocale.js", function() {
	describe("asObject()", function() {
		it("requires 2 strings and a function as parameters", function() {
			function validate(err) {
				return err.message == "Error: wrong parameters provided"
			}
			let message = "getFactorioLocale is responding incorrectly to invalid arguments"
			let callback = (err,object) => true;

			assert.throws(() => getFactorioLocale.asObject(), validate, message);
			assert.throws(() => getFactorioLocale.asObject("hello", "I forgot my callback"), validate, message);
			assert.throws(() => getFactorioLocale.asObject(undefined, undefined, callback), validate, message);

			// the proper way to do it
			getFactorioLocale.asObject("factorio_0.15.27", "en", callback);
		});
		it("returns a nested object with base game locale information", async function() {
			let object = await asObjectAsync("factorio", "en");

			assert.equal(typeof object, "object");
			assert.equal(object["entity-name"]["fish"], "Fish");
			assert.equal(object["entity-name"]["small-lamp"], "Lamp");
			let empty_keys = 0;
			Object.keys(object).forEach(key => {
				// first level of the nested object is always an object
				assert.equal(typeof object[key], "object");

				Object.keys(object[key]).forEach(key2 => {
					// second level of the nested object is always a string, nearly always truthy
					if (!object[key][key2]) {
						empty_keys++;
					}
					assert.equal(typeof object[key][key2], "string");
				});

			});
			assert(empty_keys < 10, `Got unusually high amount (${empty_keys}) of empty keys`);
		});
		it("has some duplicate keys", async function() {
			let object = await asObjectAsync("factorio", "en");

			let arrayOfKeys = [];
			// collect all keys in a single array
			Object.keys(object).forEach(key => {
				arrayOfKeys.push(key);
				Object.keys(object[key]).forEach(key2 => {
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