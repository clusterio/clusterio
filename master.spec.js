var app = require('./master.js'),
  assert = require('assert'),
  request = require('supertest');
const validateHTML = require('html5-validator');
var parallel = require('mocha.parallel');


describe('Master server endpoint testing', function() {
	describe('#GET /api/getFactorioLocale', function() { 
		it('should get the basegame factorio locale', function(done) { 
			request(app).get('/api/getFactorioLocale').end(function(err, res) {
				assert.equal(res.statusCode, 200);
				
				let object = res.body;
				
				// test that it is actual factorio locale, copied from getFactorioLocale.spec.js
				assert.equal(typeof object, "object");
				assert.equal(object["entity-name"]["fish"], "Fish");
				assert.equal(object["entity-name"]["small-lamp"], "Lamp");
				Object.keys(object).forEach(key => {
					// first level of the nested object is always an object
					assert.equal(typeof object[key], "object");
					
					Object.keys(object[key]).forEach(key2 => {
						// second level of the nested object is always a string, nearly always truthy
						if(key2 != "so-long-and-thanks-for-all-the-fish"){
							assert.ok(object[key][key2]);
							assert.equal(typeof object[key][key2], "string");
						}
					});
				});
				done();
			});
		});
	});
	// describe("#GET /api/")
	parallel("#GET static website data", function() {
		this.timeout(6000);
		it("sends some HTML when accessing /", function(done){
			this.timeout(6000);
			request(app).get("/").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 1, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /nodes",function(done){
			this.timeout(6000);
			request(app).get("/nodes").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 1, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /settings",function(done){
			this.timeout(6000);
			request(app).get("/settings").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 1, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /nodeDetails",function(done){
			this.timeout(6000);
			request(app).get("/nodeDetails").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 1, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /remoteMap",function(done){
			this.timeout(6000);
			request(app).get("/remoteMap").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					// there should be 1 error regarding complaining about me using ES6 modules before they are fully supported
					assert(result.messages.length === 2, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
	});
	let persistentMaster = request(app);
	describe("#POST /api/place", function(){
		it("adds an itemStack to the masters inventory", function(done){
			persistentMaster.post("/api/place")
			.send({
				name:"steel-plate",
				count:20,
				instanceName:"unitTest"
			})
			.end(function(err,res){
				assert(!err)
				assert.equal(res.text, "success", "something went wrong with the request")
				done();
			});
		});
	});
	describe("#GET /api/inventory", function(){
		it("returns the masters current inventory", function(done){
			persistentMaster.get("/api/inventory").end(function(err,res){
				assert.equal(res.statusCode, 200);
				let inventory = JSON.parse(res.text);
				assert.equal(typeof inventory, "object", "Inventory should be an object");
				assert(inventory.length >= 1, "There should be at least 1 entry in the inventory");
				
				let contains20SteelPlate = false;
				inventory.forEach(itemStack => {
					if(itemStack.name == "steel-plate" && itemStack.count >= 20) contains20SteelPlate = true;
				});
				assert(contains20SteelPlate, "Please ensure there are at least 20 steel plate in the inventory")
				done();
			});
		});
	});
	parallel("#POST /api/remove", function(){
		it("returns an itemStack of how many items were removed", function(done){
			persistentMaster.post("/api/remove")
			.send({
				name:"steel-plate",
				count:10
			})
			.end(function(err,res){
				assert(!err);
				assert.equal(res.body.count, 10, "Something is wrong with the response, maybe the format changed slightly or you didn't have enough steel?");
				
				done();
			});
		});
		it("returns an empty itemStack if you try to request addItem or removeItem", function(done){
			let casesRan = 0;
			persistentMaster.post("/api/remove")
			.send({
				name:"addItem",
				count:10
			})
			.end(function(err,res){
				assert(!err);
				assert.equal(res.text, '{"name":"addItem","count":0}', "When there are none of the item, you should get 0 back. addItem and removeItem should always return 0");
				
				isDone();
			});
			
			persistentMaster.post("/api/remove")
			.send({
				name:"removeItem",
				count:10
			})
			.end(function(err,res){
				assert(!err);
				assert.equal(res.text, '{"name":"removeItem","count":0}', "When there are none of the item, you should get 0 back. addItem and removeItem should always return 0");
				
				isDone();
			});
			
			function isDone(){
				if(++casesRan == 2) done();
			}
		});
		it("returns an empty itemStack if you don't have any of the item you request", function(done){
			persistentMaster.post("/api/remove")
			.send({
				name:"imaginaryItem",
				count:999999
			})
			.end(function(err,res){
				assert(!err);//{"name":"imaginaryItem","count":0}
				assert.equal(res.body.name, "imaginaryItem", "Make sure body.name is the item we asked for");
				assert.equal(res.body.count, 0, "Count should be 0 since we are asking for something that does not exist anywhere");
				assert.equal(Object.keys(res.body).length, 2, "name and count should be the only keys on this object");
				
				done();
			});
		});
	});
});
