"use strict";
var assert = require("assert");
var libObjectOps = require("@clusterio/lib/object_ops");

describe("lib/object_ops", function(){
	describe("deepclone()", function(){
		it("deep clones javascript objects", function(){
			var obj1 = { hello: "world", cat: { legs: 4, name: "Kitty", colors: ["brown", "yellow", "purple"] }};
			var obj2 = {};
			obj2 = libObjectOps.deepclone(obj1);

			obj1.cat.colors = "black";
			assert.equal(obj1.cat.colors, "black");
			assert.equal(obj2.cat.colors[1], "yellow");
		});
		it("throws on non JSON parameters", function(){
			assert.throws(function(){
				let y = libObjectOps.deepclone(libObjectOps.deepclone);
			});
		});
	});
});
