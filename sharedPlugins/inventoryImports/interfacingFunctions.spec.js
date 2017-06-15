const assert = require("assert");
const child_process = require("child_process");
const functions = require("./interfacingFunctions");
const luamin = require("luamin");
const isFactorioCommand = require("./isFactorioCommand")

describe("inventoryImports/interfacingFunctions.js", function(){
	describe("handleInventory(inventory, config)", function(){
		/*it("does things to an object", function(){
			let inventory = {'1':{inventory: {"iron-plate":63,'raw-wood': 4},requestSlots:{'raw-wood': 50,'fast-transport-belt': 50,'express-underground-belt': 50}}};
			assert.throws(function(){
				functions.handleInventory(inventory);
			}, function(err){
				// convert error to string
				let error = ""+err
				// expected error is here
				/* istanbul ignore else */
				/*if(error.includes("TypeError: Cannot read property 'masterIP' of undefined")) return true
			}, "threw unexpected error");
		});*/
		it("returns false if given invalid input", function(){
			assert(functions.handleInventory("this is a string") === false, "when given strings it should return false and do nothing");
		});
		/*it("Sends post requests", function(){
			
			var scope = nock('localhost:8080')
                .post('/api/remove', {
                  username: 'pgte',
                  email: 'pedro.teixeira@gmail.com'
                })
                .reply(201, {
                  name: "copper-plate",
                  count: 100
                });
			
			
		});*/
	});
	describe("pollInventories(outputfile)", function(){
		it("Returns a big factorio command as string", function(){
			let x = functions.pollInventories("output.txt");
			assert(typeof x == "string", "pollInventories() should always return a string");
			assert(x.includes("/silent-command ")||x.includes("/c "), "This is not a command factorio will accept, please prepend /c");
			assert(x.length > 20, "LUA string seems to short, this ain't good");
		});
		it("Returns valid LUA", function(){
			let x = functions.pollInventories("output.txt");
			
			// remove string added to make factorio interpret as command
			x = x.replace("/silent-command ","").replace("/c ","");
			
			let y = false;
			// luamin throws when it recieves something that is invalid LUA
			assert.doesNotThrow(function(){
				y = luamin.minify(x);
			}, "Invalid LUA supplied");
			assert(typeof y == "string", "luamin does not return string???");
			assert(y.length > 20, "Minified LUA too short, something is up");
		});
	});
	describe("insertItemsFromObject(object)", function(){
		let testObject = {"copper-plate":100, "iron-ore":1337}
		let playerName = "Danielv123"
		it("Returns undefined if any of the parameters are missing", function(){
			let x = functions.insertItemsFromObject();
			assert(x === undefined);
			
			let y = functions.insertItemsFromObject(testObject);
			assert(y === undefined);
			
			let z = functions.insertItemsFromObject(undefined, playerName);
			assert(z === undefined);
		});
		it("Throws if player name is not a string", function(){
			assert.throws(function(){
				let x = functions.insertItemsFromObject(testObject, testObject);
			}, "playerName is: 'object' instead of string!");
		});
		it("Returns a big factorio command as string", function(){
			let x = functions.insertItemsFromObject(testObject, playerName);
			
			assert(typeof x == "string", "LUA returned should be a string");
			assert(x.length > 20, "LUA strings are quite long");
			assert(x.includes("/silent-command ")||x.includes("/c "), "This is not a command factorio will accept, please prepend /c");
		});
		it("The returned string is a valid factorio command", function(){
			let x = functions.insertItemsFromObject(testObject, playerName);
			
			assert(isFactorioCommand(x) == true);
		});
	});
	describe("parseJsString(string) => object", function(){
		it("converts a string with JS object notation to object", function(){
			let x = functions.parseJsString("{hello:'thisAString!', yes:function(){return 'JS string!'}, not:'json'}");
			assert(!!x == true, "Should under no circumstance return a falsey value, even !!{} is truthy");
			assert(typeof x == "object", "parseJsString should return an object in this case");
			assert(typeof x.yes == "function", "parseJsString is not JSON, so it should be able to contain functions");
		});
		it("*Tries* to avoid XSS attempts by throwing on certain symbols", function(){
			assert.throws(function(){
				let x = functions.parseJsString("{};throw 'fail'");
			}, function(err) {
				let error = err+""
				/* istanbul ignore else */
				if(error.includes('parseJsString might have gotten something that could be a xss attempt')){
					return true;
				}
			}, "should throw when ; are passed because those are the simplest form of xss");
		});
	});
});