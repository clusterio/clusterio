const assert = require("assert");
const child_process = require("child_process");
const functions = require("../interfacingFunctions");
const luamin = require("luamin");
const isFactorioCommand = require("lib/isFactorioCommand");
const nock = require("nock");

// sinon does weird prototype manipulation and so doen't need to be saved to anything.
require("mocha-sinon");
const sinon = require("sinon");

describe("inventoryImports/interfacingFunctions.js", function(){
	describe("handleInventory(inventory, config)", function(){
		let config = {
			masterURL:"http://localhost:8080",
			masterAuthToken:"",
		}
		it("returns false if given invalid input", function(){
			assert(functions.handleInventory("this is a string") === false, "when given strings it should return false and do nothing");
		});
		it("Sends post requests and outputs factorio commands", function(done){
			let inventory = {
				"players":{
					"Danielv123":{
						"inventory":{
							"stone":12,
							"iron-ore":120,
							"raw-wood":10,
							"iron-plate":8,
							"steel-plate":480
						},
						"requestSlots":{
							"iron-plate":100,
							"steel-plate":480,
							"raw-wood":20,
							"bullshit":0,
						}
					}
				}
			}
			var scope = nock('http://localhost:8080')
                .post('/api/remove', function(body){
					// check that we are requesting the right things, () to convert to boolean
					// 92 because 100 requested and 8 already in inventory
					if(body.name == "iron-plate") assert(body.count == "92");
					// nock wants us to return true if this is the correct body and we should reply
					// if we return false we won't send a reply.
					return true;
				})
				// nock destroys the endpoints after being hit once, this changes the number of hits required for destruction
				.times(10)
				// respond with JSON object instead of url query parameters
                .reply(200,function(uri, req){
					return req
				},{
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				})
				// nock logging statement .log((data) => console.log(data));
			
			functions.handleInventory(inventory, config, callback);
			function callback(x){
				assert(x.includes(92) && x.includes("iron-plate"), "it should have included the items it was going to import");
				assert(!x.includes("steel-plate"), "Inventory is already filled with steel so shouldn't be importing that");
				assert(isFactorioCommand(x), "it should have returned a valid factorio command");
				assert(x.includes('"Danielv123"'), "it should include the name of the player that will recieve the items");
				done();
			}
		});
		it("posts leftovers to master", function(done){
			let inventory2 = {
				"exports":{
					"1":[
						{"name":"iron-ore","count":1200},
						{"name":"steel-plate","count":1337},
						{"name":"copper-plate","count":0},
					]
				}
			}
			let timesRan = 0;
			let callback = function(){
				timesRan++
				assert(timesRan <= 2, "placed more than 2 items, unexpeceted test result");
				if(timesRan == 2){
					done();
				}
			}
			var scope = nock('http://localhost:8080')
                .post('/api/place', function(body){
					// check that we are requesting the right things
					assert(body.name != "copper-plate", "copper plate should not be placed because it is 0");
					assert(body.count > 0, "no need for placing 0 things");
					assert(Number(body.count) != NaN, "count should be a number");
					callback();
					return true;
				})
				// nock destroys the endpoints after being hit once, this changes the number of hits required for destruction
				.times(10)
				.reply(200,"affirmative")
			// if it tries using the nonexisting callback (argv 3) it will throw. It shoudln't.
			assert.doesNotThrow(function(){
				functions.handleInventory(inventory2, config);
			}, "this here threw for some reason, remove assert.doesNotThrow for easier debugging of this issue");
		});
	});
	describe("pollInventories(outputfile)", function(){
		it("Returns a big factorio command as string", function(){
			let x = functions.pollInventories("output.txt");
			assert(typeof x == "string", "pollInventories() should always return a string");
			assert(isFactorioCommand(x), "This is not a command factorio will accept, please prepend /c");
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
			}, Error("playerName is: 'object' instead of string!"));
		});
		it("Returns a big factorio command as string", function(){
			let x = functions.insertItemsFromObject(testObject, playerName);
			
			assert(typeof x == "string", "LUA returned should be a string");
			assert(x.length > 20, "LUA strings are quite long");
			assert(isFactorioCommand(x), "This is not a command factorio will accept, please prepend /c");
		});
		it("The returned string is a valid factorio command", function(){
			let x = functions.insertItemsFromObject(testObject, playerName);
			
			assert(isFactorioCommand(x) == true);
		});
	});
});
