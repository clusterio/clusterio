var assert = require("assert");

var chunkStore = require("./chunkStore.js");

describe("chunkStore.js", () => {
	let store // make our store elevated
	it("is a constructor", ()=>{
		assert.equal(typeof chunkStore, "function");
		// create a new store and elevate it
		store = new chunkStore("910239"/* instanceID, use defaults for the rest */);
		assert.equal(store.name, "910239");
	});
	it("returns items located in a chunk", done => {
		store.getChunk(1,0).then(chunkData => {
			// console.log(chunkData);
			assert.equal(typeof chunkData, "object");
			assert(chunkData.dataArray);
			assert.equal(chunkData.position.x, 1);
			assert.equal(chunkData.position.y, 0);
			done();
		});
	});
});