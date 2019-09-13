const assert = require("assert");
const fs = require("fs");
const path = require("path");

const parallel = require("mocha.parallel");
const mkdirp = require("mkdirp");

const factorioServer = require("lib/factorioServer");

describe("class factorioServer/index.js", ()=>{
	it("is a class (or at least a function)", ()=>{
		assert.equal(typeof factorioServer, "function");
	});
	describe(".deleteInstance(instanceName)", ()=>{
		it("deletes an instance, defaulting to the classes instanceDirectory", async () => {
			let server = new factorioServer({
				instanceDirectory: path.resolve(__dirname, "_testData_deleteInstance"),
				instanceName: "Unit testing instance",
			});
			await server.initialize();
			await server.deleteInstance();
			assert.equal(await server.isValidInstance(), false);
			return true;
		});
	});
	describe(".isValidInstance(instanceName)", ()=>{
		it("tells us whether an instance exists or not", async () => {
			let server = new factorioServer({
				instanceDirectory: path.join(__dirname, "_testData_isValidInstance"),
				instanceName: "Unit testing instance",
			});
			await server.deleteInstance();
			let status = await server.isValidInstance();
			assert.equal(status, false);
			let x = await server.initialize(); // creates our instance
			let status2 = await server.isValidInstance();
			assert.equal(status2, true);
			
			await server.deleteInstance(); // clean up folder
			return true;
		});
		it("does not get tricked by an empty folder", async () => {
			let server = new factorioServer({
				instanceDirectory: path.join(__dirname, "_testData_isValidInstance_2"),
				instanceName: "Unit testing instance",
			});
			assert.equal(await server.isValidInstance(), false);
			
			mkdirp.sync(path.join(__dirname, "_testData_isValidInstance_2")); // create empty folder simulating instance
			assert.equal(await server.isValidInstance(), false);
			
			await server.initialize(); // create a proper instance
			assert.equal(await server.isValidInstance(), true);
			
			await server.deleteInstance(); // delete the instance and ensure we see that it is in fact deleted
			assert.equal(await server.isValidInstance(), false);
			
			return true;
		}).timeout(5000);
	});
	describe(".initialize()", ()=>{
		it("creates an instance", done => {
			let server = new factorioServer({
				instanceDirectory: path.resolve(__dirname, "_testData_initialize"),
				instanceName: "Unit testing instance",
			});
			server.initialize().then(()=>{
				return server.deleteInstance();
			}).then(() => {
				done();
			}).catch(e => console.log(e));
		});
	});
	describe(".createMap(mapName.zip)", ()=>{
		it("creates a map file as instanceDirectory/saves/map.zip", async function(){
			/* istanbul ignore if */ if (process.env.FAST_TEST) this.skip();
			this.timeout(20000); // these test often takes a lot of time in the map creation step (4500 ms on i3 dev system)
			let relativePath = path.relative('.', __dirname);
			let server = new factorioServer({
				instanceDirectory: path.join(relativePath, "_testData_createMap"),
				instanceName: "Unit testing instance",
				onProgress: false,
			});
			await server.initialize();
			let maps = fs.readdirSync(path.join(relativePath, "_testData_createMap", "saves"));
			assert.equal(maps.length, 0);
			await server.createMap();
			let maps2 = fs.readdirSync(path.join(relativePath, "_testData_createMap", "saves"));
			assert(maps2.includes("map.zip"));
			
			await server.deleteInstance();
			return true;
		});
		it("supports custom filenames", async function(){
			/* istanbul igoner if */ if (process.env.FAST_TEST) this.skip();
			this.timeout(20000);
			let relativePath = path.relative('.', __dirname);
			let server = new factorioServer({
				instanceDirectory: path.join(relativePath, "_testData_createMap_2"),
				instanceName: "Unit testing instance",
				onProgress: false,
			});
			await server.initialize();
			
			let maps = fs.readdirSync(path.join(relativePath, "_testData_createMap_2", "saves"));
			assert.equal(maps.length, 0);
			await server.createMap("mapWithCustomName.zip");
			let maps2 = fs.readdirSync(path.join(relativePath, "_testData_createMap_2", "saves"));
			assert(maps2.includes("mapWithCustomName.zip"));
			
			await server.deleteInstance();
			return true;
		});
	});
});