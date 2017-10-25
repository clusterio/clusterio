var app = require('./master.js'),
  assert = require('assert'),
  request = require('supertest');
const validateHTML = require('html5-validator');


describe('Master server endpoint testing', function() {
	describe('#GET /api/getFactorioLocale', function() { 
		it('should get the basegame factorio locale', function(done) { 
			request(app).get('/api/getFactorioLocale')
				.end(function(err, res) {
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
	describe("#GET static website data", function() {
		it("sends some HTML when accessing /", function(done){
			request(app).get("/").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /nodes",function(done){
			request(app).get("/nodes").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /settings",function(done){
			request(app).get("/settings").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
		it("sends some HTML when accessing /nodeDetails",function(done){
			request(app).get("/nodeDetails").end(function(err,res){
				assert.equal(res.statusCode, 200);
				validateHTML(res.text).then(result => {
					assert(result.messages.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(result.messages));
					done();
				});
			});
		});
	});
});