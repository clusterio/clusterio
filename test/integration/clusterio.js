const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const validateHTML = require('html5-validator');
const parallel = require('mocha.parallel');

const { slowTest, get, exec, sendRcon, controlConfigPath, instancesDir } = require("./index");


describe("Integration of Clusterio", function() {
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

		describe("export-data", function() {
			it("exports the data", async function() {
				slowTest(this);
				await exec(`node clusterctl --config ${controlConfigPath} export-data --instance test`);
				assert(await fs.exists(path.join("static", "export", "locale.json")), "Export was not created");
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

		describe("set-instance-config-prop", function() {
			it("applies factorio settings while running", async function() {
				slowTest(this);

				let testConfigs = [
					// json name, value to set,
					// /config name, expected result
					[
						"afk_autokick_interval", 2,
						"afk-auto-kick", "Kick if AFK for more than 2 minutes.",
					],
					[
						"allow_commands", true,
						"allow-commands", "Yes",
					],
					[
						"autosave_interval", 17,
						"autosave-interval", "Autosave every 17 minutes.",
					],
					[
						"autosave_only_on_server", false,
						"autosave-only-on-server", "Autosave only on server: false.",
					],
					[
						"description", "A test server blah blah",
						"description", "Server description: A test server blah blah",
					],
					[
						"ignore_player_limit_for_returning_players", true,
						"ignore-player-limit-for-returning-players", "Ignore player limit for returning players: true."
					],
					[
						"max_players", 11,
						"max-players", "11",
					],
					[
						"max_upload_slots", 7,
						"max-upload-slots", "7 slots.",
					],
					[
						"max_upload_in_kilobytes_per_second", 123,
						"max-upload-speed", "123 kilobytes per second.",
					],
					[
						"name", "A test",
						"name", "Server name: A test",
					],
					[
						"only_admins_can_pause_the_game", false,
						"only-admins-can-pause", "Only admins can pause: false.",
					],
					[
						"game_password", "secret",
						"password", "The server currently has a password.",
					],
					[
						"tags", ["clusterio", "test-tag"],
						"tags", "Server tags: clusterio test-tag",
					],
					[
						"visibility", { lan: false, public: false },
						"visibility-lan", "LAN visibility: false.",
					],

					// Public visibility must be reset before verify can be reset
					[
						"require_user_verification", false,
						"require-user-verification", "Verify user identity: false.",
					],
				];

				for (let [prop, value, , ] of testConfigs) {
					value = `"'${JSON.stringify(value).replace(/"/g, process.platform === "win32" ? '""' : '\\"')}'"`;
					let args = `--instance test --field factorio.settings --prop ${prop} --value ${value}`;
					await exec(`node clusterctl --config ${controlConfigPath} set-instance-config-prop ${args}`);
				}

				// Do this afterwards to leave enough to time for the
				// changes to have propogated.
				for (let [, , configName, expectedResult] of testConfigs) {
					assert.equal(await sendRcon(44, `/config get ${configName}`), `${expectedResult}\n`);
				}
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
