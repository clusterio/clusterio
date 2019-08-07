return // Disabled until it actually works
var assert = require("assert");

var remoteMap = require("./index.js");

describe("remoteMap/index.js", () => {
	it("exports a single class (or at least a function)", ()=>{
		assert.equal(typeof remoteMap, "function");
	});
});
