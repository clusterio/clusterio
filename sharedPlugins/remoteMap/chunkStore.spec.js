var assert = require("assert");

var chunkStore = require("./chunkStore.js");

describe("remoteMap/chunkStore.js", () => {
	// define some values for our test
	const inserterX = 14.5; // rounds to 15
	const inserterY = -17.5; // rounds to -17, +64 would be 47
	const inserterName = "inserter";
	
	let store // make our store elevated
	it("is a constructor", ()=>{
		assert.equal(typeof chunkStore, "function");
		// create a new store and elevate it
		store = new chunkStore("910239"/* instanceID, use defaults for the rest */, undefined, "./database/unitTests/chunkStore/");
		assert.equal(store.name, "910239");
	});
	it("allows you to store the locations of entities", done => {
		store.setEntity(inserterX, inserterY, {name:inserterName, otherData:"can be arbitrary"}).then(() => {
			done();
			// nothing to do here really
		});
	});
	it("returns entities at positions you query for", done => {
		setTimeout(()=>{
			store.getEntity(inserterX, inserterY).then(entities => {
				entity = entities[0]
				// console.log(entity)
				assert.equal(entity.x, 14);
				assert.equal(entity.y, -18);
				assert.equal(entity.entity.name, "inserter");
				assert.equal(entity.entity.otherData, "can be arbitrary");
				done();
			});
		},300);
	});
	it("deletes entities when not provided with an object as 3rd arg", done => {
		store.setEntity(inserterX, inserterY).then(entity => {
			assert(entity === undefined);
			setTimeout(()=>{
				store.getEntity(inserterX, inserterY).then(entities => {
					// console.log(entities)
					assert.equal(entities.length, 0, "Why are we getting results, it should be empty?");
					done();
				});
			},300);
		});
	});
});
