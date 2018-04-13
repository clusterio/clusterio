const assert = require("assert");

const isFactorioCommand = require("_app/isFactorioCommand");

const researchSync = require("./index.js");

describe("researchSync/index.js", ()=>{
	it("exports a single class (or at least a function)", ()=>{
		assert.equal(typeof researchSync, "function");
	});
	describe("class researchSync()", ()=>{
		it(".diff(object1, object2) returns key:value pairs that exist in object2 but not object1", ()=>{
			let reSync = new researchSync({}, function(){});
			
			let obj1 = {
				a:"str",
				b:123,
				c:console.log,
				d:"apple cake",
			}
			let obj2 = {
				a:"str",
				b:9999,
				c:console.log,
				e:"truthy",
			}
			assert(typeof reSync.diff == "function");
			
			let diffResult = reSync.diff(obj1, obj2);
			assert(diffResult.a === undefined);
			assert(diffResult.b === 9999);
			assert(diffResult.d === undefined);
			assert(diffResult.e === "truthy");
		});
		it(".pollResearch() dumps a long Lua command", ()=>{
			let reSync = new researchSync({}, io);
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}
			
			assert(!ioRecieved);
			
			reSync.pollResearch();
			
			assert(ioRecieved);
		});
		describe(".scriptOutput(data) handles file writes from factorio", ()=>{
			it("wants a Lua table of a single research, parses and saves it", ()=>{
				let reSync = new researchSync({hi:"hello"}, console.log);
				let researches = [
					'{automation = false}',
					'{["automation-2"] = false}',
					'{["automation-3"] = false}',
					'{electronics = false}',
					'{["advanced-electronics"] = false}',
					'{["advanced-electronics-2"] = false}',
					'{["circuit-network"] = false}',
					'{explosives = false}',
					'{logistics = false}',
					'{["logistics-2"] = false}',
				]
				researches.forEach(research => {
					reSync.scriptOutput(research);
					assert(isFactorioCommand("/c x = "+research));
				});
				assert(Object.keys(reSync.research).length == researches.length);
			});
		});
		it("regularily polls and syncs research (configurable delay)", (done)=>{
			let reSync = new researchSync({}, io, {
				researchSyncPollInterval: 100,
			});
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}
			function waitForIo(){
				if(!ioRecieved){
					setTimeout(waitForIo,50);
				} else {
					done();
				}
			}
			waitForIo();
		});
	});
});
