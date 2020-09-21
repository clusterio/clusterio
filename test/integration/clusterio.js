"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const validateHTML = require("html5-validator");
const parallel = require("mocha.parallel");

const link = require("@clusterio/lib/link");

const { slowTest, get, execCtl, sendRcon, getControl, instancesDir } = require("./index");


describe("Integration of Clusterio", function() {
	parallel("master web interface", function() {
		this.timeout(6000);

		let paths = ["/", "/nodes", "/settings", "/nodeDetails"];
		for (let path of paths) {
			it(`sends some HTML when accessing ${path}`, async function() {
				let res = await get(path);
				let validation = await validateHTML(res.body.toString());
				let filtered = validation.messages.filter(msg => msg.type !== "info");
				assert(
					filtered.length === 0,
					"there are HTML errors on the page, please fix: "+JSON.stringify(validation.messages, null, 4)
				);
			});
		}
	});


	describe("clusterioctl", function() {
		describe("slave list", function() {
			it("runs", async function() {
				await execCtl("slave list");
			});
		});
		describe("instance list", function() {
			it("runs", async function() {
				await execCtl("instance list");
			});
		});

		describe("instance create", function() {
			it("runs", async function() {
				await execCtl("instance create test --id 44");
			});
		});

		describe("instance assign", function() {
			it("creates the instance files", async function() {
				await execCtl("instance assign test 4");
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance was not created");
			});
		});

		describe("instance create-save", function() {
			it("creates a save", async function() {
				slowTest(this);
				await execCtl("instance create-save test");
			});
		});

		describe("instance export-data", function() {
			it("exports the data", async function() {
				slowTest(this);
				await execCtl("instance export-data test");
				assert(await fs.exists(path.join("static", "export", "locale.json")), "Export was not created");
			});
		});

		describe("instance start", function() {
			it("starts the instance", async function() {
				slowTest(this);
				await execCtl("instance start test");
				// TODO check that the instance actually started
			});
		});

		describe("instance send-rcon", function() {
			it("sends the command", async function() {
				slowTest(this);
				await execCtl("instance send-rcon test test");
				// TODO check that the command was received
			});
		});

		describe("instance config set-prop", function() {
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
						"ignore-player-limit-for-returning-players", "Ignore player limit for returning players: true.",
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

				for (let [prop, value, ,] of testConfigs) {
					value = `"'${JSON.stringify(value).replace(/"/g, process.platform === "win32" ? '""' : '\\"')}'"`;
					let args = `test factorio.settings ${prop} ${value}`;
					await execCtl(`instance config set-prop ${args}`);
				}

				// Do this afterwards to leave enough to time for the
				// changes to have propogated.
				for (let [, , configName, expectedResult] of testConfigs) {
					assert.equal(await sendRcon(44, `/config get ${configName}`), `${expectedResult}\n`);
				}
			});
		});

		describe("user set-admin/whitelisted/banned", function() {
			async function getUsers() {
				let result = await link.messages.listUsers.send(getControl());
				return new Map(result.list.map(user => [user.name, user]));
			}

			let lists = ["admin", "whitelisted", "banned"];
			it("should add and remove the given user to the list", async function() {
				slowTest(this);
				await link.messages.createUser.send(getControl(), { name: "list_test" });
				let user = (await getUsers()).get("list_test");
				for (let list of lists) {
					assert.equal(user[`is_${list}`], false, `unexpected ${list} status`);
					await execCtl(`user set-${list} list_test`);
				}
				user = (await getUsers()).get("list_test");
				for (let list of lists) {
					assert.equal(user[`is_${list}`], true, `unexpected ${list} status`);
					let remove = { admin: "--revoke", whitelisted: "--remove", banned: "--pardon" }[list];
					await execCtl(`user set-${list} ${remove} list_test`);
				}
				user = (await getUsers()).get("list_test");
				for (let list of lists) {
					assert.equal(user[`is_${list}`], false, `unexpected ${list} status`);
				}
			});
			it("should not create the user if not instructed to", async function() {
				slowTest(this);
				for (let list of lists) {
					try {
						await execCtl(`user set-${list} no_create_test`);
					} catch (err) { /* ignore */ }
				}
				let user = (await getUsers()).get("no_create_test");
				assert.equal(user, undefined, "user was unexpectedly created");
			});
			it("should create the user if instructed to", async function() {
				slowTest(this);
				for (let list of lists) {
					await execCtl(`user set-${list} --create test_create_${list}`);
					let user = (await getUsers()).get(`test_create_${list}`);
					assert.equal(user && user[`is_${list}`], true, `user not created and added to ${list}`);
				}
			});
		});

		describe("instance stop", function() {
			it("stops the instance", async function() {
				slowTest(this);
				await execCtl("instance stop test");
				// TODO check that the instance actually stopped
			});
		});

		describe("instance delete", function() {
			it("deletes the instance", async function() {
				slowTest(this);
				await execCtl("instance delete test");
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance was not deleted");
			});
		});

		describe("permission list", function() {
			it("runs", async function() {
				await execCtl("permission list");
			});
		});

		describe("role list", function() {
			it("runs", async function() {
				await execCtl("role list");
			});
		});

		describe("role create", function() {
			it("should create the given role", async function() {
				let args = "--description \"A temp role\" --permissions core.control.connect";
				await execCtl(`role create temp ${args}`);
				let result = await link.messages.listRoles.send(getControl());
				let role = result.list.find(role => role.name === "temp");
				assert.deepEqual(role, { id: 5, name: "temp", description: "A temp role", permissions: ["core.control.connect"] });
			});
		});

		describe("role edit", function() {
			it("should modify the given role", async function() {
				let args = "--name new --description \"A new role\" --permissions";
				await execCtl(`role edit temp ${args}`);
				let result = await link.messages.listRoles.send(getControl());
				let role = result.list.find(role => role.name === "new");
				assert.deepEqual(role, { id: 5, name: "new", description: "A new role", permissions: [] });
			});
		});

		describe("role delete", function() {
			it("should modify the given role", async function() {
				await execCtl("role delete new");
				let result = await link.messages.listRoles.send(getControl());
				let role = result.list.find(role => role.name === "new");
				assert(!role, "Role was not deleted");
			});
		});

		describe("user list", function() {
			it("runs", async function() {
				await execCtl("user list");
			});
		});

		describe("user create", function() {
			it("should create the given user", async function() {
				await execCtl("user create temp");
				let result = await link.messages.listUsers.send(getControl());
				let user = result.list.find(user => user.name === "temp");
				assert(user, "user was not created");
			});
		});

		describe("user set-roles", function() {
			it("should set the roles on the user", async function() {
				await execCtl("user set-roles temp Admin");
				let result = await link.messages.listUsers.send(getControl());
				let user = result.list.find(user => user.name === "temp");
				assert.deepEqual(user.roles, [0]);
			});
		});

		describe("user delete", function() {
			it("should delete the user", async function() {
				await execCtl("user delete temp");
				let result = await link.messages.listUsers.send(getControl());
				let user = result.list.find(user => user.name === "temp");
				assert(!user, "user was note deleted");
			});
		});
	});
});
