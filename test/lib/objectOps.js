var assert = require("assert");
var objectOps = require("lib/objectOps");

describe("objectOps.js", function(){
	/*describe("objectOps.clone()", function(){
		it("clones javascript objects", function(){
			var object1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
			var object2 = {};
			object2 = objectOps.clone(object1);
			
			assert.equal(object2.cat.name, object1.cat.name)
			assert.equal(object1.hello, object2.hello)
		});	
		it("does not deep clone objects", function(){
			var obj1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
			var obj2 = {};
			obj2 = objectOps.clone(obj1);
			
			obj1.cat.colors = "black";
			assert.equal(obj1.cat.colors, "black");
			assert.notEqual(obj2.cat.colors[1], "yellow");
		});
	});*/
	describe("objectOps.deepclone()", function(){
		it("deep clones javascript objects", function(){
			var obj1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
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