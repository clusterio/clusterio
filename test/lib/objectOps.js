"use strict";
var assert = require("assert");
var objectOps = require("lib/objectOps");

describe("objectOps.js", function(){
	describe("objectOps.deepclone()", function(){
		it("deep clones javascript objects", function(){
			var obj1 = { hello: "world", cat: { legs: 4, name: "Kitty", colors: ["brown", "yellow", "purple"] }};
			var obj2 = {};
			obj2 = objectOps.deepclone(obj1);

			obj1.cat.colors = "black";
			assert.equal(obj1.cat.colors, "black");
			assert.equal(obj2.cat.colors[1], "yellow");
		});
		it("throws on non JSON parameters", function(){
			assert.throws(function(){
				let y = objectOps.deepclone(objectOps.deepclone);
			});
		});
	});
});
