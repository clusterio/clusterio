var assert = require("assert");

var chunkStore = require("./chunkStore.js");

describe("chunkStore.js", () => {
	// define some values for our test
	const inserterX = 14.5;
	const inserterY = -7.5;
	const inserterName = "inserter";
	
	let store // make our store elevated
	it("is a constructor", ()=>{
		assert.equal(typeof chunkStore, "function");
		// create a new store and elevate it
		store = new chunkStore("910239"/* instanceID, use defaults for the rest */);
		assert.equal(store.name, "910239");
	});
	it("allows you to store the locations of entities in a chunk divided database", () => {
		return store.setEntity(inserterX, inserterY, {name:inserterName}).then(() => {
			// nothing to do here really
		});
	});
	it("returns items located in a chunk", () => {
		// We return the promise to mocha as it supports promises natively, works a lot better than calling done() manually.
		let x = 0;
		let y = -1
		return store.getChunk(x,y).then(chunkData => {
			// console.log(chunkData);
			assert.equal(typeof chunkData, "object");
			assert.equal(chunkData.get(inserterX, inserterY).name, inserterName);
			assert.equal(chunkData.position.x, x);
			assert.equal(chunkData.position.y, y);
		});
	});
	it("deletes entities when not provided with an object as 3rd arg", () => {
		return store.setEntity(inserterX, inserterY).then((chunk)=>{
			assert(!chunk.get(inserterX, inserterY));
		});
	});
});