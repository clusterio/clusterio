const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const validateHTML = require('html5-validator');
const parallel = require('mocha.parallel');

const { slowTest, get, exec, controlConfigPath, instancesDir } = require("./index");


describe("Integration of Clusterio", function() {
	describe("master http api", function() {
		describe("GET /api/getFactorioLocale", function() {
			it("should get the basegame factorio locale", async function() {
				let res = await get("/api/getFactorioLocale");
				let object = res.body;

				// test that it is looks like a factorio locale
				assert.equal(typeof object, "object");
				assert.equal(object["entity-name"]["fish"], "Fish");
				assert.equal(object["entity-name"]["small-lamp"], "Lamp");
			});
		});
	});
	parallel("master web interface", function() {
		this.timeout(6000);

		let paths = ["/", "/nodes", "/settings", "/nodeDetails"];
		for (let path of paths) {
			it(`sends some HTML when accessing ${path}`, async function() {
				let res = await get(path);
				let validation = await validateHTML(res.body);
				let filtered = validation.messages.filter(msg => msg.type !== "info");
				assert(
					filtered.length === 0,
					"there are HTML errors on the page, please fix: "+JSON.stringify(validation.messages, null, 4)
				);
			});
		}
	});


	describe("clusterctl", function() {
		describe("list-slaves", function() {
			it("runs", async function() {
				await exec(`node clusterctl --config ${controlConfigPath} list-slaves`);
			});
		});
		describe("list-instances", function() {
			it("runs", async function() {
				await exec(`node clusterctl --config ${controlConfigPath} list-instances`);
			});
		});

		describe("create-instances", function() {
			it("runs", async function() {
				await exec(`node clusterctl --config ${controlConfigPath} create-instance --id 44 --name test`);
			});
		});

		describe("assign-instance", function() {
			it("creates the instance files", async function() {
				await exec(`node clusterctl --config ${controlConfigPath} assign-instance --instance test --slave 4`);
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance was not created");
			});
		});

		describe("create-save", function() {
			it("creates a save", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} create-save --instance test`);
			});
		});

		describe("start-instance", function() {
			it("starts the instance", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} start-instance --instance test`);
				// TODO check that the instance actually started
			});
		});

		describe("send-rcon", function() {
			it("sends the command", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} send-rcon --instance test --command test`);
				// TODO check that the command was received
			});
		});

		describe("stop-instance", function() {
			it("stops the instance", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} stop-instance --instance test`);
				// TODO check that the instance actually stopped
			});
		});

		describe("delete-instance", function() {
			it("deletes the instance", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} delete-instance --instance test`);
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance was not deleted");
			});
		});
	});
});
