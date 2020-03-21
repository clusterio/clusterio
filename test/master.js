const assert = require('assert').strict;
const request = require('supertest');
const validateHTML = require('html5-validator');
const parallel = require('mocha.parallel');

const config = require("lib/config");
const plugin = require("lib/plugin");
const mock = require('./mock');
const master = require('../master');


master._db.slaves = new Map();

before(async function() {
	let pluginInfos = await plugin.loadPluginInfos("plugins");
	config.registerPluginConfigGroups(pluginInfos);
	config.finalizeConfigs();
	let masterConfig = new config.MasterConfig();
	await masterConfig.load({
		groups: [{
			name: "master",
			fields: {
				auth_secret: "TestSecretDoNotUse",
				http_port: 8880,
				https_port: 4443,
			},
		}]
	});

	master._setConfig(masterConfig);
})

async function get(path) {
	return await request(master.app).get(path).expect(200);
}

async function getValidate(path) {
	let res = await get(path);
	let validation = await validateHTML(res.text);
	let filtered = validation.messages.filter(msg => msg.type !== "info");
	assert(filtered.length === 0, "there are HTML errors on the page, please fix: "+JSON.stringify(validation.messages, null, 4));
}

describe('Master testing', function() {
	describe('#GET /api/getFactorioLocale', function() {
		it('should get the basegame factorio locale', async function() {
			let res = await get('/api/getFactorioLocale');
			let object = res.body;

			// test that it is looks like a factorio locale
			assert.equal(typeof object, "object");
			assert.equal(object["entity-name"]["fish"], "Fish");
			assert.equal(object["entity-name"]["small-lamp"], "Lamp");
		});
	});
	// describe("#GET /api/")
	parallel("#GET static website data", function() {
		this.timeout(6000);

		let paths = ["/", "/nodes", "/settings", "/nodeDetails"];
		for (let path of paths) {
			it(`sends some HTML when accessing ${path}`, () => getValidate(path));
		}
	});

	describe("class WebSocketServerConnector", function() {
		let testConnector = new master._WebSocketServerConnector(new mock.MockSocket());
		describe(".disconnect()", function() {
			it("should call disconnect on the socket", function() {
				testConnector._socket.terminateCalled = false;
				testConnector.disconnect();
				assert(testConnector._socket.terminateCalled, "Terminate was not called");
			});
		});
	});
});
