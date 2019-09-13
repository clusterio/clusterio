const isFactorioCommand = require("lib/isFactorioCommand");
const assert = require("assert");

describe("inventoryImports/isFactorioCommand.js()", function(){
	it("Returns false if input is not a factorio command", function(){
		assert(isFactorioCommand({}) == false, "This is not even a string so should return false");
		assert(isFactorioCommand("Howdy boys!") == false, "This is not a command so should return false");
		assert(isFactorioCommand("/c this ain't a command because its invalid LUA") == false, "This is not valid LUA so it should return false");
		assert(isFactorioCommand("Trying to trick the system /c game.print('Hello world!')") == false, "this is still not a command");
		
	});
	it("Returns true if it is a valid command", function(){
		assert(isFactorioCommand("/c game.print('hello world')"), "This is a valid command, should output true not false")
	});
	it("Fails to understand that leading spaces are valid", function(){
		assert(isFactorioCommand("  /c game.print('Hello world!')") == false, "This should be true but often returns false unintentionally. If you see this you probably fixed the bug so change this test, OK?")
	});
});