"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const events = require("events");

const libLink = require("@clusterio/lib/link");
const libUsers = require("@clusterio/lib/users");

const {
	TestControl, TestControlConnector, url, controlToken, slowTest,
	get, exec, execCtl, sendRcon, getControl, instancesDir,
} = require("./index");


async function getInstances() {
	let result = await libLink.messages.listInstances.send(getControl());
	return new Map(result.list.map(instance => [instance.id, instance]));
}

async function checkInstanceStatus(id, status) {
	let instances = await getInstances();
	assert.equal(instances.get(44).status, status, "incorrect instance status");
}

describe("Integration of Clusterio", function() {
	describe("clusteriomaster", function() {
		describe("bootstrap generate-user-token", function() {
			it("work for existing user", async function() {
				await exec("node ../../packages/master bootstrap generate-user-token test");
			});

			it("fails if user does not exist", async function() {
				await assert.rejects(
					exec("node ../../packages/master bootstrap generate-user-token invalid")
				);
			});
		});

		describe("run", function() {
			it("should handle resume of an active connection", async function() {
				slowTest(this);
				let tlsCa = await fs.readFile("test/file/tls/cert.pem");
				let connectorA = new TestControlConnector(url, 2, tlsCa);
				connectorA.token = controlToken;
				let controlA = new TestControl(connectorA);
				await connectorA.connect();
				connectorA._state = "closing";
				connectorA.stopHeartbeat();
				connectorA.on("error", () => {});

				let connectorB = new TestControlConnector(url, 2, tlsCa);
				connectorB.token = controlToken;
				let controlB = new TestControl(connectorB);
				connectorB._sessionToken = connectorA._sessionToken;
				connectorB._state = "handshake";
				await connectorB._doConnect();
				await events.once(connectorB, "resume");
				await connectorB.close();
			});
		});
	});

	describe("clusterioctl", function() {
		describe("master config list", function() {
			it("runs", async function() {
				await execCtl("master config list");
			});
			it("should not leak auth_secret", async function() {
				let result = await libLink.messages.getMasterConfig.send(getControl());
				let done = false;
				for (let group of result.serialized_config.groups) {
					if (group.name === "master") {
						assert.equal(Object.prototype.hasOwnProperty.call(group.fields, "auth_secret"), false);
						done = true;
						break;
					}
				}
				assert(done, "master group not found");
			});
		});
		describe("master config set", function() {
			it("sets given config option", async function() {
				await execCtl('master config set master.name "Test Cluster"');
				let result = await libLink.messages.getMasterConfig.send(getControl());
				let done = false;
				for (let group of result.serialized_config.groups) {
					if (group.name === "master") {
						assert.equal(group.fields.name, "Test Cluster");
						done = true;
						break;
					}
				}
				assert(done, "master group not found");
			});
			it("should not allow setting auth_secret", async function() {
				await assert.rejects(execCtl("master config set master.auth_secret root"));
			});
		});

		describe("master plugin list", function() {
			it("runs", async function() {
				await execCtl("master plugin list");
			});
		});

		describe("slave list", function() {
			it("runs", async function() {
				await execCtl("slave list");
			});
		});
		describe("slave generate-token", function() {
			it("runs", async function() {
				await execCtl("slave generate-token --id 42");
			});
		});
		describe("instance list", function() {
			it("runs", async function() {
				await execCtl("instance list");
			});
		});

		describe("instance create", function() {
			it("creates the instance", async function() {
				await execCtl("instance create test --id 44");
				let instances = await getInstances();
				assert(instances.has(44), "instance was not created");
				assert.equal(instances.get(44).status, "unassigned", "incorrect instance status");
			});
		});

		describe("instance assign", function() {
			it("creates the instance files", async function() {
				await execCtl("instance assign test 4");
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance directory was not created");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance create-save", function() {
			it("creates a save", async function() {
				slowTest(this);
				await execCtl("instance create-save test");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance export-data", function() {
			it("exports the data", async function() {
				slowTest(this);
				let exportPath = path.join("temp", "test", "static", "export", "locale.json");
				await fs.remove(exportPath);
				await execCtl("instance export-data test");
				assert(await fs.exists(exportPath), "Export was not created");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance start", function() {
			it("starts the instance", async function() {
				slowTest(this);
				await execCtl("instance start test");
				await checkInstanceStatus(44, "running");
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
						"allow-commands", "Allow Lua commands: Yes.",
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

				for (let [prop, value] of testConfigs) {
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
			it("should not change the instance status", async function() {
				slowTest(this);
				await checkInstanceStatus(44, "running");
			});
		});

		describe("user set-admin/whitelisted/banned", function() {
			async function getUsers() {
				let result = await libLink.messages.listUsers.send(getControl());
				return new Map(result.list.map(user => [user.name, user]));
			}

			let lists = ["admin", "whitelisted", "banned"];
			it("should add and remove the given user to the list", async function() {
				slowTest(this);
				await libLink.messages.createUser.send(getControl(), { name: "list_test" });
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
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance delete", function() {
			it("deletes the instance", async function() {
				slowTest(this);
				await execCtl("instance delete test");
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance files was not deleted");
				let instances = await getInstances();
				assert(!instances.has(44), "instance was not deleted from master");
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
				let result = await libLink.messages.listRoles.send(getControl());
				let tempRole = result.list.find(role => role.name === "temp");
				assert.deepEqual(
					tempRole,
					{ id: 5, name: "temp", description: "A temp role", permissions: ["core.control.connect"] }
				);
			});
		});

		describe("role edit", function() {
			it("should modify the given role", async function() {
				let args = "--name new --description \"A new role\" --set-perms";
				await execCtl(`role edit temp ${args}`);
				let result = await libLink.messages.listRoles.send(getControl());
				let newRole = result.list.find(role => role.name === "new");
				assert.deepEqual(newRole, { id: 5, name: "new", description: "A new role", permissions: [] });
			});
			it("should add permissions with --add-perms", async function() {
				let args = "--name new --add-perms core.slave.list core.instance.list";
				await execCtl(`role edit new ${args}`);
				let result = await libLink.messages.listRoles.send(getControl());
				let newRole = result.list.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, ["core.slave.list", "core.instance.list"]);
			});
			it("should remove permissions with --remove-perms", async function() {
				let args = "--name new --remove-perms core.slave.list";
				await execCtl(`role edit new ${args}`);
				let result = await libLink.messages.listRoles.send(getControl());
				let newRole = result.list.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, ["core.instance.list"]);
			});
			it("should grant default permissions with --grant-default", async function() {
				await execCtl("role edit new --grant-default");
				let result = await libLink.messages.listRoles.send(getControl());
				let newRole = result.list.find(role => role.name === "new");
				let defaultPermissions = [...libUsers.permissions.values()]
					.filter(p => p.grantByDefault)
					.map(p => p.name)
				;
				assert.deepEqual(new Set(newRole.permissions), new Set(defaultPermissions));
			});
		});

		describe("role delete", function() {
			it("should delete the given role", async function() {
				await execCtl("role delete new");
				let result = await libLink.messages.listRoles.send(getControl());
				let newRole = result.list.find(role => role.name === "new");
				assert(!newRole, "Role was not deleted");
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
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert(tempUser, "user was not created");
			});
		});

		describe("user set-roles", function() {
			it("should set the roles on the user", async function() {
				await execCtl('user set-roles temp "Cluster Admin"');
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert.deepEqual(tempUser.roles, [0]);
			});
		});

		describe("user delete", function() {
			it("should delete the user", async function() {
				await execCtl("user delete temp");
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert(!tempUser, "user was note deleted");
			});
		});
	});
});
