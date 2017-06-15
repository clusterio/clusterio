const isJson = require("./isJson");
const assert = require("assert");

describe("inventoryImports/isJson.js()", function(){
	it("checks if a thing is valid JSON", function(){
		assert(isJson("string") === false);
		assert(isJson("{js_object_notation='very false'}") === false);
		assert(isJson('{ "name":"John", "age":31, "city":"New York" }') === true, "This is valid JSON, lib disagrees");
	});
	it("recognizes that true and false are both valid JSON", function(){
		assert(isJson(true) === true);
		assert(isJson(false) === true);
	});
	it("Handles null as valid JSON (after spec)", function(){
		assert(isJson(null) === true);
	});
	it("Recognizes that JSON doesn't allow trailing commas (,)", function(){
		assert(isJson('["a", "b", ]') === false, "JSON should not allow trailing commas");
	});
});
