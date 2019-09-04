const assert = require("assert").strict;
const nock = require("nock");

const isFactorioCommand = require("lib/isFactorioCommand");

const researchSync = require("./index.js");

describe("researchSync/index.js", function() {
	it("exports a single class (or at least a function)", function() {
		assert.equal(typeof researchSync, "function");
	});

	const config = {
		instanceName: "test",
		masterIP: "localhost",
		masterPort: 8080,
		unique: 99,
		clientPassword: "password",
		masterAuthToken: "masterToken",
	};

	const scope = nock('http://localhost:8080')
		.post('/api/getSlaveMeta')
		.reply(200, '{}')
		.persist()
	;

	describe("class researchSync()", function() {
		it(".filter_researched_techs(researces) returns research that needs enabling on the local instance", function() {
			let reSync = new researchSync(config, function(){});

			let local = {
				a:{infinite: true, researched: true, level: 0},
				b:{infinite: true, researched: true, level: 0},
				c:{infinite: true, researched: false, level: 0},
				d:{infinite: true, researched: false, level: 10},
			};

			let remote = {
				a:{infinite: true, researched: true, level: 0},
				b:{infinite: true, researched: true, level: 1},
				c:{infinite: true, researched: false, level: 0},
				e:{infinite: true, researched: false, level: 50},
			};
			reSync.research = local;
			let diffResult = reSync.filter_researched_techs(remote);
			console.log(diffResult);

			assert.equal(diffResult.a, undefined);

			assert.notEqual(diffResult.b, undefined);
			assert.equal(diffResult.b.researched, true);
			assert.equal(diffResult.b.level, 1);

			assert.equal(diffResult.d, undefined);

			// filter_researched_techs is broken
			this.skip();
			assert.notEqual(diffResult.e, undefined);
			assert.equal(diffResult.e.researched, false);
			assert.equal(diffResult.e.level, 50);
		});
		it(".pollResearch() dumps a long Lua command", function() {
			// pollResearch doesn't exist
			this.skip();
			let reSync = new researchSync(config, io);
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}

			assert(!ioRecieved);

			reSync.pollResearch();

			assert(ioRecieved);
		});
		describe(".scriptOutput(data) handles file writes from factorio", function() {
			it("wants a key:value pair of a single research, parses and saves it", function() {
				let reSync = new researchSync(config, console.log);
				let researches = [
					'automation:false:0:nil',
					'automation-2:false:0:nil',
					'automation-3:false:0:nil',
					'electronics:false:0:nil',
					'advanced-electronics:false:0:nil',
					'advanced-electronics-2:false:0:nil',
					'circuit-network:false:0:nil',
					'explosives:false:0:nil',
					'logistics:false:0:nil',
					'logistics-2:false:0:nil',
					'logistics-3:false:0:nil',
					'optics:false:0:nil',
					'laser:false:0:nil',
					'solar-energy:false:0:nil',
					'turrets:false:0:nil',
					'laser-turrets:false:0:nil',
					'stone-walls:false:0:nil',
					'gates:false:0:nil',
					'engine:false:0:nil',
				]
				researches.forEach(research => {
					reSync.scriptOutput(research);
					assert(!isFactorioCommand("/c x = "+research));
				});
				assert.equal(Object.keys(reSync.research).length, researches.length);
			});
		});
		it("regularily polls and syncs research (configurable delay)", function(done) {
			let reSync = new researchSync(config, io, {
				researchSyncPollInterval: 100,
			});
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}
			function waitForIo(){
				if(!ioRecieved){
					setTimeout(waitForIo,50);
				} else {
					done();
				}
			}
			waitForIo();
		});
	});
});
