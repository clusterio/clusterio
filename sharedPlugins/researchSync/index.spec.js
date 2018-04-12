const assert = require("assert");

const researchSync = require("./index.js");

describe("researchSync/index.js", ()=>{
	it("exports a single class (or at least a function)", ()=>{
		assert.equal(typeof researchSync, "function");
	});
	describe("class researchSync()", ()=>{
		it(".diff(object1, object2) returns key:value pairs that exist in object2 but not object1", ()=>{
			let reSync = new researchSync();
			
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
	});
});
