const assert = require("assert");
const getFactorioLocale = require("./getFactorioLocale");

describe("getFactorioLocale.js", () => {
	describe("asObject()", () => {
		it("requires 2 strings and a function as parameters", () => {
			let validate = (err) => {
				return err == "Error: wrong parameters provided"
			}
			let message = "getFactorioLocale is responding incorrectly to invalid arguments"
			let callback = (err,object) => true;
			
			assert.throws(() => getFactorioLocale.asObject(), validate, message);
			assert.throws(() => getFactorioLocale.asObject("hello", "I forgot my callback"), validate, message);
			assert.throws(() => getFactorioLocale.asObject(undefined, undefined, callback), validate, message);
			
			// the proper way to do it
			assert.doesNotThrow(() => getFactorioLocale.asObject("factorio_0.15.27", "en", callback), validate, message);
		});
		it("returns a nested object with base game locale information", (done) => {
			getFactorioLocale.asObject("factorio", "en", callback);
			
			function callback(err, object){
				assert.equal(typeof object, "object");
				assert.equal(object["entity-name"]["fish"], "Fish");
				assert.equal(object["entity-name"]["small-lamp"], "Lamp");
				Object.keys(object).forEach(key => {
					// first level of the nested object is always an object
					assert.equal(typeof object[key], "object");
					
					Object.keys(object[key]).forEach(key2 => {
						// second level of the nested object is always a string, nearly always truthy
						if(key2 != "so-long-and-thanks-for-all-the-fish"){
							assert.ok(object[key][key2]);
							assert.equal(typeof object[key][key2], "string");
						}
					});
				});
				done();
			}
		});
		it("has some duplicate keys", (done) => {
			getFactorioLocale.asObject("factorio", "en", callback);
			
			function callback(err, object){
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
				done();
			}
		});
	});
});