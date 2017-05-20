const sinon = require("sinon");
var assert = require('assert');
const libomega = require('./libomega');
/*
describe('The webpage module', function () {
  it('saves the content', function * () {
    const url = 'google.com'
    const content = '<h1>title</h1>'
    const writeFileStub = this.sandbox.stub(fs, 'writeFile', function (filePath, fileContent, cb) {
      cb(null)
    })

    const requestStub = this.sandbox.stub(request, 'get', function (url, cb) {
      cb(null, null, content)
    })

    const result = yield webpage.saveWebpage(url)

    expect(writeFileStub).to.be.calledWith()
    expect(requestStub).to.be.calledWith(url)
    expect(result).to.eql('page')
  })
})
*/
describe("libomega.js", function(){
	describe("libomega.clone", function(){
		it("clones javascript objects", function(){
			var object1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
			var object2 = {};
			object2 = libomega.clone(object1);
			
			assert.equal(object2.cat.name, object1.cat.name)
			assert.equal(object1.hello, object2.hello)
		});	
		it("does not deep clone objects", function(){
			var obj1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
			var obj2 = {};
			obj2 = libomega.clone(obj1);
			
			obj1.cat.colors = "black";
			assert.equal(obj1.cat.colors, "black");
			assert.notEqual(obj2.cat.colors[1], "yellow");
		});
	});
	describe("libomega.deepclone", function(){
		it("deep clones javascript objects", function(){
			var obj1 = {hello:"world", cat:{legs:4, name:"Kitty", colors:["brown", "yellow", "purple"]}};
			var obj2 = {};
			obj2 = libomega.deepclone(obj1);
			
			obj1.cat.colors = "black";
			assert.equal(obj1.cat.colors, "black");
			assert.equal(obj2.cat.colors[1], "yellow");
		});
		it("throws on non JSON parameters", function(){
			x = function(){};
			assert.throws(function(){
				y = libomega.deepclone(x)
			});
		});
	});
});