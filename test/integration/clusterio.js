"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");
const path = require("path");
const events = require("events");
const phin = require("phin");

const lib = require("@clusterio/lib");
const libBuildMod = require("@clusterio/lib/build_mod");
const { wait } = lib;

const testStrings = require("../lib/factorio/test_strings");
const {
	TestControl, TestControlConnector, url, controlToken, slowTest,
	exec, execCtl, sendRcon, getControl, spawnNode, instancesDir, factorioDir,
} = require("./index");


/** @returns {Promise<Map<number, lib.InstanceDetails>>} */
async function getInstances() {
	let instances = await getControl().send(new lib.InstanceDetailsListRequest());
	return new Map(instances.map(instance => [instance.id, instance]));
}

async function checkInstanceStatus(id, status) {
	let instances = await getInstances();
	assert.equal(instances.get(44).status, status, "incorrect instance status");
}

async function spawnAltHost(config = "alt-host-config.json") {
	return await spawnNode("alt-host:", `../../packages/host run --config ${config}`, /Started host/);
}

async function startAltHost() {
	let config = "alt-host-config.json";
	let configPath = path.join("temp", "test", config);
	await fs.remove(configPath);
	await fs.remove(path.join("temp", "test", "alt-instances"));
	await fs.remove(path.join("temp", "test", "alt-mods"));
	await execCtl(`host create-config --id 5 --name alt-host --generate-token --output ${config}`);
	await exec(`node ../../packages/host --config ${config} config set host.tls_ca ../../test/file/tls/cert.pem`);
	await exec(`node ../../packages/host --config ${config} config set host.instances_directory alt-instances`);
	const dir = path.isAbsolute(factorioDir) ? factorioDir : path.join("..", "..", factorioDir);
	await exec(`node ../../packages/host --config ${config} config set host.factorio_directory ${dir}`);
	await exec(`node ../../packages/host --config ${config} config set host.mods_directory alt-mods`);
	return await spawnAltHost(config);
}

async function stopAltHost(hostProcess) {
	if (hostProcess && hostProcess.exitCode === null) {
		const waitForExit = lib.timeout(
			events.once(hostProcess, "exit"),
			10e3,
			"timeout"
		).catch(() => {});
		try {
			await execCtl("host stop 5");
		} catch (err) {
			// Some tests cause the host to stop
		}
		if (await waitForExit === "timeout" && hostProcess.exitCode === null) {
			// eslint-disable-next-line no-console
			console.warn("Stopping alt-host failed. Killing.");
			hostProcess.kill("SIGINT");
		}
	}
}

async function runWithAltHost(callback) {
	let hostProcess;
	try {
		hostProcess = await startAltHost();
		return await callback();
	} finally {
		await stopAltHost(hostProcess);
	}
}

async function uploadSave(instanceId, name, content) {
	return await phin({
		url: `https://localhost:4443/api/upload-save?instance_id=${instanceId}&filename=${name}`,
		method: "POST",
		core: { rejectUnauthorized: false },
		headers: {
			"X-Access-Token": controlToken,
			"Content-Type": "application/zip",
			"Content-Length": String(content.length),
		},
		data: content,
	});
}

async function deleteSave(instanceId, save) {
	await getControl().send(new lib.InstanceDeleteSaveRequest(instanceId, save));
}

async function getUsers() {
	let users = await getControl().send(new lib.UserListRequest());
	return new Map(users.map(user => [user.id, user]));
}

function jsonArg(value) {
	return `"${JSON.stringify(value).replace(/"/g, process.platform === "win32" ? '""' : '\\"')}"`;
}

describe("Integration of Clusterio", function() {
	describe("clusteriocontroller", function() {
		describe("bootstrap generate-user-token", function() {
			it("work for existing user", async function() {
				await exec("node ../../packages/controller bootstrap generate-user-token test");
			});

			it("fails if user does not exist", async function() {
				await assert.rejects(
					exec("node ../../packages/controller bootstrap generate-user-token invalid")
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
				connectorA._closing = true;
				connectorA.stopHeartbeat();
				connectorA.on("error", () => {});

				let connectorB = new TestControlConnector(url, 2, tlsCa);
				connectorB.token = controlToken;
				connectorB.src = connectorA.src;
				let controlB = new TestControl(connectorB);
				connectorB._sessionToken = connectorA._sessionToken;
				connectorB._sessionTimeout = connectorA._sessionTimeout;
				connectorB._startedResumingMs = Date.now();
				connectorB._state = "resuming";
				connectorB._doConnect();
				await events.once(connectorB, "resume");
				await connectorB.close(1000, "");
			});
		});

		describe("queryLogRequestHandler", function() {
			it("should honnor the limit", async function() {
				let result = await getControl().send(
					new lib.LogQueryRequest(true, false, [], [], undefined, 10, "asc")
				);
				assert.equal(result.log.length, 10);
			});
			it("should return entries by order", async function() {
				let first = await getControl().send(new lib.LogQueryRequest(true, false, [], [], undefined, 1, "asc"));
				let last = await getControl().send(new lib.LogQueryRequest(true, false, [], [], undefined, 1, "desc"));
				assert(first.log[0].timestamp < last.log[0].timestamp, "first log entry happened after last");
			});
		});
	});

	describe("clusteriohost", function() {
		describe("hostUpdateEventHandler()", function() {
			it("should trigger when a new host is added", async function() {
				slowTest(this);
				getControl().hostUpdates = [];

				await runWithAltHost(async () => {
					await execCtl("instance create alt-test --id 99");
					await execCtl("instance assign alt-test 5");
				});

				let sawUpdate = false;
				let sawConnected = false;
				let sawDisconnected = false;

				for (let update of getControl().hostUpdates) {
					if (update.name !== "alt-host") {
						continue;
					}

					sawUpdate = true;
					if (update.connected) {
						sawConnected = true;
					} else {
						sawDisconnected = true;
					}
				}

				assert(sawUpdate, "No host update was sent");
				assert(sawConnected, "No host update with status connected was sent");
				assert(sawDisconnected, "No host update with status disconnected was sent");

				let result = await getControl().send(new lib.HostListRequest());
				let hosts = new Map(result.map(instance => [instance.id, instance]));
				assert(hosts.has(5), "Host list was not updated");
			});
		});
		it("should download mods from controller", async function() {
			slowTest(this);
			await runWithAltHost(async () => {
				const clusterioLib = path.join("temp", "test", "alt-mods", "clusterio_lib_0.1.2.zip");
				assert(!await fs.pathExists(clusterioLib), "mod was downloaded before the test");
				await execCtl("instance create alt-mod --id 98");
				await execCtl("instance assign alt-mod 5");
				await execCtl("instance save create alt-mod");
				assert(await fs.pathExists(clusterioLib), "mod was not downloaded by the test");
			});
		});
		it("should auto start instances with auto_start enabled", async function() {
			slowTest(this);

			let hostProcess;
			try {
				hostProcess = await startAltHost();
				await execCtl("instance create alt-start --id 97");
				await execCtl("instance assign alt-start 5");
				await execCtl("instance config set alt-start instance.auto_start true");
				await stopAltHost(hostProcess);
				hostProcess = await spawnAltHost();
				// Stop the host immediatly to test the handling of stopping
				// instances while automatically started and a save is being created
				await stopAltHost(hostProcess);
				hostProcess = await spawnAltHost();
				let status;
				// Wait for instance status to become running.
				for (let i = 0; i < 100; i++) {
					const instances = await getInstances();
					status = instances.get(97)?.status ?? "not_present";
					if (status === "running") {
						break;
					}
					await wait(100); // Try again 10 times per second.
				}
				assert.equal(status, "running");
				await execCtl("instance stop alt-start");
				await execCtl("instance delete alt-start");
			} finally {
				await stopAltHost(hostProcess);
			}
		});
	});

	describe("clusterioctl", function() {
		describe("controller config list", function() {
			it("runs", async function() {
				await execCtl("controller config list");
			});
			it("should not leak auth_secret", async function() {
				let result = await getControl().send(new lib.ControllerConfigGetRequest());
				assert.equal(Object.prototype.hasOwnProperty.call(result, "controller.auth_secret"), false);
			});
		});
		describe("controller config set", function() {
			it("sets given config option", async function() {
				await execCtl('controller config set controller.name "Test Cluster"');
				let result = await getControl().send(new lib.ControllerConfigGetRequest());
				assert.equal(result["controller.name"], "Test Cluster");
			});
			it("should not allow setting auth_secret", async function() {
				await assert.rejects(execCtl("controller config set controller.auth_secret root"));
			});
		});

		describe("controller plugin list", function() {
			it("runs", async function() {
				await execCtl("controller plugin list");
			});
		});

		describe("host list", function() {
			it("runs", async function() {
				await execCtl("host list");
			});
		});
		describe("host config", function() {
			it("changes host config", async function() {
				await execCtl("host config set 4 host.name My-Host");
				const result = await execCtl("host config list 4");
				assert(/My-Host/.test(result.stdout), "New host name not in config output");
			});
			it("should not allow setting host.controller_token", async function() {
				await assert.rejects(
					execCtl("host config set 4 host.controller_token xyz"),
					/Field 'host\.controller_token' is not accessible/,
				);
			});
			it("should not allow setting host.id", async function() {
				await assert.rejects(
					execCtl("host config set 4 host.id 200"),
					/Setting 'host\.id' while host is running is not supported/,
				);
			});
			it("should not leak host.controller_token", async function() {
				let result = await getControl().sendTo({ hostId: 4 }, new lib.HostConfigGetRequest());
				assert.equal(Object.prototype.hasOwnProperty.call(result, "host.controller_token"), false);
			});
		});
		describe("host generate-token", function() {
			it("runs", async function() {
				await execCtl("host generate-token --id 42");
			});
			it("runs without an id", async function() {
				await execCtl("host generate-token");
			});
		});
		describe("host revoke-token", async function() {
			it("should disconnect existing host", async function() {
				slowTest(this);
				let sawDisconnected;
				await runWithAltHost(async () => {
					getControl().hostUpdates = [];
					await execCtl("host revoke-token 5");
					for (let update of getControl().hostUpdates) {
						if (update.name !== "alt-host") {
							continue;
						}

						if (!update.connected) {
							sawDisconnected = true;
						}
					}
				});

				assert(sawDisconnected, "No host update with status disconnected was sent after revoking token");
			});
		});
		describe("instance list", function() {
			it("runs", async function() {
				await execCtl("instance list");
			});
		});

		describe("instance create", function() {
			it("creates the instance", async function() {
				this.timeout(6000);
				await execCtl("instance create test --id 44");
				let instances = await getInstances();
				assert(instances.has(44), "instance was not created");
				assert.equal(instances.get(44).status, "unassigned", "incorrect instance status");

				// Make sure the following tests does not fail due to not having internet
				let value = JSON.stringify({ lan: true, public: false }).replace(
					/"/g, process.platform === "win32" ? '""' : '\\"'
				);
				await execCtl(`instance config set-prop test factorio.settings visibility "${value}"`);
				await execCtl("instance config set-prop test factorio.settings require_user_verification false");
			});
		});

		describe("instance assign", function() {
			it("creates the instance files", async function() {
				await execCtl("instance assign test 4");
				assert(await fs.exists(path.join(instancesDir, "test")), "Instance directory was not created");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance save create", function() {
			it("creates a save", async function() {
				slowTest(this);
				getControl().saveUpdates = [];
				await execCtl("instance save create test");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("InstanceSaveDetailsUpdatesEvent", function() {
			it("should have triggered for the created save", function() {
				slowTest(this);
				assert.equal(getControl().saveUpdates.slice(-1)[0].updates[0].name, "world.zip");
			});
		});

		describe("instance save list", function() {
			it("lists the created save", async function() {
				slowTest(this);
				let result = await execCtl("instance save list test");
				assert(/world\.zip/.test(result.stdout), "world.zip not present in list save output");
			});
		});

		describe("instance export-data", function() {
			it("exports the data", async function() {
				slowTest(this);
				let exportPath = path.join("temp", "test", "static");
				await fs.remove(exportPath);
				await execCtl("instance export-data test");
				let modPack = await getControl().send(new lib.ModPackGetDefaultRequest());
				let assets = modPack.exportManifest.assets;
				assert(Object.keys(assets).length > 1, "Export assets is empty");
				for (let key of ["settings", "prototypes", "item-metadata", "item-spritesheet", "locale"]) {
					assert(assets[key], `Missing ${key} from assets`);
					assert(
						await fs.exists(path.join(exportPath, assets[key])),
						`Manifest entry for ${key} was not written to filesystem`
					);
				}
				let prototypes = JSON.parse(await fs.readFile(path.join(exportPath, assets["prototypes"])));
				assert(Object.keys(prototypes).length > 50, "Expected there to be more than 50 prototype types");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance start", function() {
			it("should not hang if factorio version does not exist", async function() {
				slowTest(this);
				try {
					await execCtl("instance config set 44 factorio.version 0.1.2");
					await assert.rejects(execCtl("instance start test"));

				} finally {
					await execCtl("instance config set 44 factorio.version latest");
				}
			});
			it("should not leave the instance in the stopping state if it fails", async function() {
				slowTest(this);
				try {
					await execCtl("instance config set 44 factorio.game_port 100000");
					await assert.rejects(execCtl("instance start test"));
					await checkInstanceStatus(44, "stopped");

				} finally {
					await execCtl("instance config set 44 factorio.game_port");
				}
			});
			it("starts the given save", async function() {
				slowTest(this);
				await execCtl("instance start test --save world.zip");
				await checkInstanceStatus(44, "running");
			});
			it("copies the save if an autosave is the target", async function() {
				slowTest(this);
				await execCtl("instance stop 44");
				let savesDir = path.join("temp", "test", "instances", "test", "saves");
				await fs.copy(path.join(savesDir, "world.zip"), path.join(savesDir, "_autosave1.zip"));
				await execCtl("instance start test");
				let saves = await getControl().sendTo({ instanceId: 44 }, new lib.InstanceSaveDetailsListRequest());
				let running = saves.find(s => s.loaded);
				assert(running.name !== "_autosave1.zip");
			});
		});

		describe("instance send-rcon", function() {
			this.afterAll(async function() {
				// Prevents cascading failure where enable_script_commands is expected to be true
				await execCtl("instance config set test factorio.enable_script_commands true");
			});
			it("sends the command", async function() {
				slowTest(this);
				await execCtl("instance send-rcon test technobabble");
				let { log } = await getControl().send(
					new lib.LogQueryRequest(false, false, [], [44], undefined, 10, "desc")
				);
				assert(log.some(info => /technobabble/.test(info.message)), "Command was not sent");
			});

			it("should trigger InstanceSaveDetailsUpdatesEvent on save", async function() {
				slowTest(this);
				getControl().saveUpdates = [];
				await execCtl("instance send-rcon test /server-save");
				let received = false;
				for (let x = 0; x < 10; x++) {
					if (getControl().saveUpdates.length) {
						received = true;
						break;
					}
					await wait(100);
				}
				assert(received, "InstanceSaveDetailsUpdatesEvent not sent");
			});
			it("should prevent execution of script commands when disabled", async function() {
				slowTest(this);
				await execCtl("instance send-rcon test /c");
				const r1 = await getControl().send(
					new lib.LogQueryRequest(false, false, [], [44], undefined, 10, "desc")
				);
				assert(r1.log.some(info => /\[COMMAND\]/.test(info.message)), "Command was not sent");
				await execCtl("instance config set test factorio.enable_script_commands false");

				assert.rejects(
					execCtl("instance send-rcon test /c"),
					new Error(
						"Attempted to use script command while disabled. " +
						"See config factorio.enable_script_commands.\nCommand: /c"
					)
				);
				await execCtl("instance config set test factorio.enable_script_commands true");
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
						"allow_commands", "true",
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
					let args = `test factorio.settings ${prop} ${jsonArg(value)}`;
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
			it("should allow creating and removing props", async function() {
				slowTest(this);
				await execCtl("instance config set-prop test factorio.settings new_property new-string-value");
				let config = await getControl().send(new lib.InstanceConfigGetRequest(44));
				assert.equal(config["factorio.settings"]["new_property"], "new-string-value");
				await execCtl("instance config set-prop test factorio.settings new_property");
				config = await getControl().send(new lib.InstanceConfigGetRequest(44));
				assert.equal(config["factorio.settings"]["new_property"], undefined);
			});
		});

		describe("user set-admin/whitelisted/banned", function() {
			async function getUser(name) {
				return await getControl().send(new lib.UserGetRequest(name));
			}

			let lists = [["admin", "isAdmin"], ["whitelisted", "isWhitelisted"], ["banned", "isBanned"]];
			it("should add and remove the given user to the list", async function() {
				slowTest(this);
				getControl().userUpdates = [];
				await getControl().send(new lib.UserCreateRequest("list_test"));
				let user = (await getUsers()).get("list_test");
				for (let [listName, prop] of lists) {
					assert.equal(user[prop], false, `unexpected ${listName} status`);
					await execCtl(`user set-${listName} list_test`);
				}
				user = (await getUsers()).get("list_test");
				for (let [listName, prop] of lists) {
					assert.equal(user[prop], true, `unexpected ${listName} status`);
					let remove = { admin: "--revoke", whitelisted: "--remove", banned: "--pardon" }[listName];
					await execCtl(`user set-${listName} ${remove} list_test`);
				}
				user = (await getUsers()).get("list_test");
				for (let [listName, prop] of lists) {
					assert.equal(user[prop], false, `unexpected ${listName} status`);
				}
				assert.equal(getControl().userUpdates.length, 7);
			});
			it("should not create the user if not instructed to", async function() {
				slowTest(this);
				for (let [listName, prop] of lists) {
					try {
						await execCtl(`user set-${listName} no_create_test`);
					} catch (err) { /* ignore */ }
				}
				let user = (await getUsers()).get("no_create_test");
				assert.equal(user, undefined, "user was unexpectedly created");
			});
			it("should create the user if instructed to", async function() {
				slowTest(this);
				getControl().userUpdates = [];
				for (let [listName, prop] of lists) {
					await execCtl(`user set-${listName} --create test_create_${listName}`);
					let user = (await getUsers()).get(`test_create_${listName}`);
					assert.equal(user && user[prop], true, `user not created and added to ${listName}`);
				}
				assert.equal(getControl().userUpdates.length, 3);
			});
			it("should send ban reason", async function() {
				slowTest(this);
				getControl().userUpdates = [];
				await execCtl("user set-banned --create test_ban_reason --reason a-reason");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].banReason, "a-reason");
				let user = await getUser("test_ban_reason");
				assert.equal(user.banReason, "a-reason");
			});
			it("should send ban list commands to running instances", async function() {
				slowTest(this);
				// Check that both names are not on the list
				const preCommandStateLower = await sendRcon(44, "/banlist get test_rcon_ban");
				const preCommandStateUpper = await sendRcon(44, "/banlist get test_RCON_ban");
				assert.equal(preCommandStateLower, "test_rcon_ban is not banned.\n", "User is already banned");
				assert.equal(preCommandStateUpper, "test_RCON_ban is not banned.\n", "User is already banned");

				// Add the lower case name to the list
				await execCtl("user set-banned --create test_rcon_ban --reason a-reason");
				const addCommandStateLower = await sendRcon(44, "/banlist get test_rcon_ban");
				const addCommandStateUpper = await sendRcon(44, "/banlist get test_RCON_ban");
				assert.equal(addCommandStateLower, "test_rcon_ban is banned.\n", "User is not banned");
				assert.equal(addCommandStateUpper, "test_RCON_ban is banned.\n", "User is not banned");

				// Remove the upper case name from the list
				await execCtl("user set-banned --create test_RCON_ban --pardon");
				const removeCommandStateLower = await sendRcon(44, "/banlist get test_rcon_ban");
				const removeCommandStateUpper = await sendRcon(44, "/banlist get test_RCON_ban");
				assert.equal(removeCommandStateLower, "test_rcon_ban is not banned.\n", "User is banned");
				assert.equal(removeCommandStateUpper, "test_RCON_ban is not banned.\n", "User is banned");

				// Check it is case insensitive by checking it was converted correctly
				const users = await getUsers();
				assert(users.has("test_rcon_ban"), "User ID was not lowercase");
				assert(!users.has("test_RCON_ban"), "Username was not converted to User ID");
			});
			it("should send whitelist commands to running instances", async function() {
				slowTest(this);
				// Check that both names are not on the list
				const preCommandStateLower = await sendRcon(44, "/whitelist get test_rcon_whitelist");
				const preCommandStateUpper = await sendRcon(44, "/whitelist get test_RCON_whitelist");
				assert.equal(preCommandStateLower,
					"test_rcon_whitelist is not whitelisted.\n", "User is already whitelisted");
				assert.equal(preCommandStateUpper,
					"test_RCON_whitelist is not whitelisted.\n", "User is already whitelisted");

				// Add the lower case name to the list
				await execCtl("user set-whitelisted --create test_rcon_whitelist");
				const addCommandStateLower = await sendRcon(44, "/whitelist get test_rcon_whitelist");
				const addCommandStateUpper = await sendRcon(44, "/whitelist get test_RCON_whitelist");
				assert.equal(addCommandStateLower,
					"test_rcon_whitelist is whitelisted.\n", "User is not whitelisted");
				assert.equal(addCommandStateUpper,
					"test_RCON_whitelist is whitelisted.\n", "User is not whitelisted");

				// Remove the upper case name from the list
				await execCtl("user set-whitelisted --create test_RCON_whitelist --remove");
				const removeCommandStateLower = await sendRcon(44, "/whitelist get test_rcon_whitelist");
				const removeCommandStateUpper = await sendRcon(44, "/whitelist get test_RCON_whitelist");
				assert.equal(removeCommandStateLower,
					"test_rcon_whitelist is not whitelisted.\n", "User is whitelisted");
				assert.equal(removeCommandStateUpper,
					"test_RCON_whitelist is not whitelisted.\n", "User is whitelisted");

				// Check it is case insensitive by checking it was converted correctly
				const users = await getUsers();
				assert(users.has("test_rcon_whitelist"), "User ID was not lowercase");
				assert(!users.has("test_RCON_whitelist"), "Username was not converted to User ID");
			});
			it("should send admin list commands to running instances", async function() {
				this.skip(); // It is not currently possible to get admin state without the player joining the game
				slowTest(this);
				// Check that both names are not on the list
				const preCommandStateLower = await sendRcon(44, "/admins get test_rcon_admin");
				const preCommandStateUpper = await sendRcon(44, "/admins get test_RCON_admin");
				assert.equal(preCommandStateLower, "test_rcon_admin is not admin.\n", "User is already admin");
				assert.equal(preCommandStateUpper, "test_RCON_admin is not admin.\n", "User is already admin");

				// Add the lower case name to the list
				await execCtl("user set-admin --create test_rcon_admin");
				const addCommandStateLower = await sendRcon(44, "/admins get test_rcon_admin");
				const addCommandStateUpper = await sendRcon(44, "/admins get test_RCON_admin");
				assert.equal(addCommandStateLower, "test_rcon_admin is admin.\n", "User is not admin");
				assert.equal(addCommandStateUpper, "test_RCON_admin is admin.\n", "User is not admin");

				// Remove the upper case name from the list
				await execCtl("user set-admin --create test_RCON_admin --revoke");
				const removeCommandStateLower = await sendRcon(44, "/admins get test_rcon_admin");
				const removeCommandStateUpper = await sendRcon(44, "/admins get test_RCON_admin");
				assert.equal(removeCommandStateLower, "test_rcon_admin is not admin.\n", "User is admin");
				assert.equal(removeCommandStateUpper, "test_RCON_admin is not admin.\n", "User is admin");

				// Check it is case insensitive by checking it was converted correctly
				const users = await getUsers();
				assert(users.has("test_rcon_admin"), "User ID was not lowercase");
				assert(!users.has("test_RCON_admin"), "Username was not converted to User ID");
			});
		});

		describe("instance extract-players", function() {
			it("runs", async function() {
				slowTest(this);
				await execCtl("instance extract-players test");
			});
		});

		describe("instance stop", function() {
			it("stops the instance", async function() {
				slowTest(this);
				await execCtl("instance stop test");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance load-scenario", function() {
			it("starts the instance with the given settings", async function() {
				slowTest(this);
				await execCtl("instance config set 44 factorio.enable_save_patching false");
				await execCtl("instance config set 44 player_auth.load_plugin false");
				await execCtl("instance config set 44 research_sync.load_plugin false");
				await execCtl("instance config set 44 statistics_exporter.load_plugin false");
				await execCtl("instance config set 44 subspace_storage.load_plugin false");

				let exchangeString = testStrings.modified.replace(/[\n\r]+/g, "");
				let args = `base/freeplay --seed 1234 --map-exchange-string "${exchangeString}"`;
				await execCtl(`instance load-scenario test ${args}`);
				await checkInstanceStatus(44, "running");
				await sendRcon(44, '/c game.print("disable achievements")');
				await sendRcon(44, '/c game.print("disable achievements")');
				assert.equal(await sendRcon(44, "/c rcon.print(game.default_map_gen_settings.seed)"), "1234\n");
				assert.equal(await sendRcon(44, "/c rcon.print(game.map_settings.pollution.ageing)"), "1.5\n");
				assert.equal(
					await sendRcon(44, "/c rcon.print(game.difficulty_settings.research_queue_setting)"), "never\n"
				);
			});
		});

		describe("instance kill", function() {
			it("kills the instance", async function() {
				slowTest(this);
				await execCtl("instance kill test");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("instance save upload", function() {
			it("should upload a zip file", async function() {
				await fs.outputFile(path.join("temp", "test", "upload.zip"), "a test");
				await execCtl("instance save upload 44 upload.zip");
				assert(
					await fs.pathExists(path.join("temp", "test", "instances", "test", "saves", "upload.zip")),
					"file not uploaded to saves directory"
				);
			});
			it("should reject non-zip files", async function() {
				await fs.outputFile(path.join("temp", "test", "invalid"), "a test");
				await assert.rejects(execCtl("instance save upload 44 invalid"));
			});
			it("should reject path traversal attacks", async function() {
				await fs.outputFile(path.join("temp", "test", "upload.zip"), "a test");
				await assert.rejects(execCtl("instance save upload 44 upload.zip --name ../traversal.zip"));
			});
		});

		describe("instance save download", function() {
			it("should download a save", async function() {
				await fs.remove(path.join("temp", "test", "upload.zip"));
				await execCtl("instance save download 44 upload.zip");
				assert(await fs.pathExists(path.join("temp", "test", "upload.zip")));
			});
			it("should error if save does not exist", async function() {
				await assert.rejects(execCtl("instance save download 44 invalid"));
			});
			it("should error on path traversal attacks", async function() {
				await assert.rejects(execCtl("instance save download 44 ../factorio-current.log"));
			});
		});

		describe("instance save copy", function() {
			it("copy a save file", async function() {
				await execCtl("instance save copy 44 upload.zip copy.zip");
				assert(await fs.pathExists(path.join("temp", "test", "instances", "test", "saves", "copy.zip")));
			});
			it("should error if destination exist", async function() {
				await assert.rejects(execCtl("instance save copy 44 upload.zip copy.zip"));
			});
			it("should error if source does not exist", async function() {
				await assert.rejects(execCtl("instance save copy 44 not-here.zip invalid.zip"));
			});
			it("should reject path traversal attacks", async function() {
				this.timeout(4000);
				await assert.rejects(execCtl("instance save copy 44 upload.zip ../traversal.zip"));
				await assert.rejects(execCtl("instance save copy 44 ../saves/upload.zip traversal.zip "));
			});
		});

		describe("instance save rename", function() {
			it("rename a save file", async function() {
				await execCtl("instance save rename 44 copy.zip rename.zip");
				assert(!await fs.pathExists(path.join("temp", "test", "instances", "test", "saves", "copy.zip")));
				assert(await fs.pathExists(path.join("temp", "test", "instances", "test", "saves", "rename.zip")));
			});
			it("should error if new name exist", async function() {
				await assert.rejects(execCtl("instance save rename 44 upload.zip rename.zip"));
			});
			it("should error if old name does not exist", async function() {
				await assert.rejects(execCtl("instance save rename 44 not-here.zip invalid.zip"));
			});
			it("should reject path traversal attacks", async function() {
				this.timeout(4000);
				await assert.rejects(execCtl("instance save rename 44 upload.zip ../traversal.zip"));
				await assert.rejects(execCtl("instance save rename 44 ../saves/upload.zip traversal.zip "));
			});
		});

		describe("instance save transfer", function() {
			before(async function() {
				slowTest(this);
				await execCtl("instance create spam --id 66");
				await execCtl("instance assign spam 4");
				await execCtl("instance create unassign --id 77");
			});
			after(async function() {
				try {
					await execCtl("instance delete spam");
				} catch (err) {
					// Ignore
				}
			});
			for (let remote of [false, true]) {
				let pri = 44;
				let sec = remote ? 88 : 66;
				let priSaves = path.join("temp", "test", "instances", "test", "saves");
				let secSaves = remote
					? path.join("temp", "test", "alt-instances", "save-test", "saves")
					: path.join("temp", "test", "instances", "spam", "saves")
				;
				describe(remote ? "remote" : "local", function() {
					if (remote) {
						let hostProcess;
						before(async function() {
							slowTest(this);

							hostProcess = await startAltHost();
							await execCtl("instance create save-test --id 88");
							await execCtl("instance assign save-test 5");
						});
						after(async function() {
							await stopAltHost(hostProcess);
						});
					}
					it("should transfers a save", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await execCtl(`instance save transfer ${pri} transfer.zip ${sec}`);
						assert(!await fs.pathExists(path.join(priSaves, "transfer.zip")), "save still at pri");
						assert(await fs.pathExists(path.join(secSaves, "transfer.zip")), "save not at sec");
						await deleteSave(sec, "transfer.zip");
					});
					it("should support rename", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await execCtl(`instance save transfer ${pri} transfer.zip ${sec} rename.zip`);
						assert(!await fs.pathExists(path.join(priSaves, "transfer.zip")), "save still at pri");
						assert(await fs.pathExists(path.join(secSaves, "rename.zip")), "save not at sec");
						await deleteSave(sec, "rename.zip");
					});
					it("should auto-rename if target exists", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await uploadSave(sec, "transfer.zip", "transfer.zip");
						await execCtl(`instance save transfer ${pri} transfer.zip ${sec}`);
						assert(!await fs.pathExists(path.join(priSaves, "transfer.zip")), "save still at pri");
						assert(await fs.pathExists(path.join(secSaves, "transfer-2.zip")), "save not at sec");
						await deleteSave(sec, "transfer.zip");
						await deleteSave(sec, "transfer-2.zip");
					});
					it("should copy when using --copy", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await execCtl(`instance save transfer ${pri} transfer.zip ${sec} --copy`);
						assert(await fs.pathExists(path.join(priSaves, "transfer.zip")), "save not at pri");
						assert(await fs.pathExists(path.join(secSaves, "transfer.zip")), "save not at sec");
						await deleteSave(pri, "transfer.zip");
						await deleteSave(sec, "transfer.zip");
					});
					it("should fail if save does not exist", async function() {
						await assert.rejects(execCtl(`instance save transfer ${pri} not-here.zip ${sec}`));
					});
					it("should fail if source save name is invalid", async function() {
						await assert.rejects(execCtl(`instance save transfer ${pri} nul 111`));
					});
					it("should fail if target save name is invalid", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await assert.rejects(execCtl(`instance save transfer ${pri} transfer.zip 111 nul`));
						await deleteSave(pri, "transfer.zip");
					});
					it("should reject path traversal of source save", async function() {
						await assert.rejects(execCtl(`instance save transfer ${pri} ../saves/transfer.zip 111`));
					});
					it("should reject path traversal of target save", async function() {
						await uploadSave(pri, "transfer.zip", "transfer.zip");
						await assert.rejects(
							execCtl(`instance save transfer ${pri} transfer.zip 111 ../saves/transfer.zip`)
						);
						await deleteSave(pri, "transfer.zip");
					});
					if (!remote) {
						it("should fail if source and target instance is the same instance", async function() {
							await uploadSave(pri, "transfer.zip", "transfer.zip");
							await assert.rejects(execCtl(`instance save transfer ${pri} transfer.zip ${pri}`));
							await deleteSave(pri, "transfer.zip");
						});
						it("should fail if source instance does not exist", async function() {
							await assert.rejects(execCtl(`instance save transfer 111 not-here.zip ${sec}`));
						});
						it("should fail if target instance does not exist", async function() {
							await uploadSave(pri, "transfer.zip", "transfer.zip");
							await assert.rejects(execCtl(`instance save transfer ${pri} transfer.zip 111`));
							await deleteSave(pri, "transfer.zip");
						});
						it("should fail if source instance is not assigned", async function() {
							await assert.rejects(execCtl(`instance save transfer 77 transfer.zip ${pri}`));
						});
						it("should fail if target instance is not assigned", async function() {
							await uploadSave(pri, "transfer.zip", "transfer.zip");
							await assert.rejects(execCtl(`instance save transfer ${pri} transfer.zip 77`));
							await deleteSave(pri, "transfer.zip");
						});
					}
				});
			}

		});

		describe("instance save delete", function() {
			it("should delete a save", async function() {
				await execCtl("instance save delete 44 upload.zip");
				assert(
					!await fs.pathExists(path.join("temp", "test", "instances", "test", "saves", "upload.zip")),
					"file not deleted"
				);
			});
			it("should error if save does not exist", async function() {
				await assert.rejects(execCtl("instance save delete 44 upload.zip"));
			});
			it("should error on path traversal attacks", async function() {
				await fs.outputFile(path.join("temp", "test", "upload.zip"), "a test");
				await assert.rejects(execCtl("instance save delete 44 ../../upload.zip"));
			});
		});

		describe("instance delete", function() {
			it("deletes the instance", async function() {
				slowTest(this);
				getControl().saveUpdates = [];
				await execCtl("instance delete test");
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance files was not deleted");
				let instances = await getInstances();
				assert(!instances.has(44), "instance was not deleted from controller");

				const saveUpdates = getControl().saveUpdates;
				assert.equal(saveUpdates.length, 1, "Expected one update sent on saves");
				assert(saveUpdates[0].updates.length > 0, "Expected saves update to contain at least one save updated");
				assert(saveUpdates[0].updates.every(update => update.isDeleted), "Expected all saves to be deleted");
			});
		});

		describe("instanceUpdateEventHandler()", function() {
			it("should have triggered for the previous instance status updates", function() {
				slowTest(this);
				let statusesToCheck = new Set([
					"unassigned", "stopped", "creating_save", "exporting_data",
					"starting", "running", "stopping", "deleted", "unknown",
				]);
				let statusesNotSeen = new Set(statusesToCheck);

				for (let update of getControl().instanceUpdates) {
					assert(statusesToCheck.has(update.status), `Missing check for status ${update.status}`);
					statusesNotSeen.delete(update.status);
				}

				assert(statusesNotSeen.size === 0, `Did not see the statuses ${[...statusesNotSeen]}`);
			});
		});

		describe("mod-pack create", function() {
			it("should create a mod-pack", async function() {
				await execCtl("mod-pack create empty-pack 1.1.0");
				let modPacks = await getControl().send(new lib.ModPackListRequest());
				assert(modPacks.some(modPack => modPack.name === "empty-pack"), "created pack is not in the list");
			});
			it("should allow setting all fields", async function() {
				const color = { r: 1, g: 0, b: 1, a: 0 };
				await execCtl(
					"mod-pack create full-pack 0.17.59 " +
					"--description Description " +
					"--mods empty_mod:1.0.0 " +
					"--bool-setting startup MyBool true " +
					"--int-setting runtime-global MyInt 1235 " +
					"--double-setting runtime-global MyDouble 12.25 " +
					"--string-setting runtime-per-user MyString a-string " +
					`--color-setting runtime-per-user MyColor ${jsonArg(color)}`
				);
				let modPacks = await getControl().send(new lib.ModPackListRequest());
				let modPack = modPacks.find(entry => entry.name === "full-pack");
				assert(modPack, "created mod pack not found");
				let reference = lib.ModPack.fromJSON({ factorio_version: "0.17.59" });
				reference.id = modPack.id;
				reference.name = "full-pack";
				reference.description = "Description";
				reference.factorioVersion = "0.17.59";
				reference.mods.set("empty_mod", { name: "empty_mod", enabled: true, version: "1.0.0" });
				reference.settings["startup"].set("MyBool", { value: true });
				reference.settings["runtime-global"].set("MyInt", { value: 1235 });
				reference.settings["runtime-global"].set("MyDouble", { value: 12.25 });
				reference.settings["runtime-per-user"].set("MyString", { value: "a-string" });
				reference.settings["runtime-per-user"].set("MyColor", { value: color });
				reference.updatedAtMs = modPack.updatedAtMs;
				assert.deepEqual(modPack, reference);
			});
		});

		describe("mod-pack list", function() {
			it("runs", async function() {
				await execCtl("mod-pack list");
			});
		});

		describe("mod-pack show", function() {
			it("runs", async function() {
				await execCtl("mod-pack show empty-pack");
			});
		});

		describe("mod-pack import/export", function() {
			it("should should roundtrip a mod-pack", async function() {
				slowTest(this);
				let reference = lib.ModPack.fromJSON({});
				reference.name = "imported-pack";
				reference.description = "Description";
				reference.factorioVersion = "0.17.59";
				reference.mods.set("empty_mod", { name: "empty_mod", enabled: true, version: "1.0.0" });
				reference.settings["startup"].set("MyBool", { value: true });
				reference.settings["runtime-global"].set("MyInt", { value: 1235 });
				reference.settings["runtime-global"].set("MyDouble", { value: 12.25 });
				reference.settings["runtime-per-user"].set("MyString", { value: "a-string" });
				await execCtl(`mod-pack import ${reference.toModPackString()}`);
				const result = await execCtl("mod-pack export imported-pack");
				const roundtrip = lib.ModPack.fromModPackString(result.stdout.trim());
				roundtrip.id = reference.id;
				assert.deepEqual(roundtrip, reference);
			});
		});

		describe("mod-pack edit", function() {
			it("runs", async function() {
				await execCtl("mod-pack edit full-pack --factorio-version 1.2.0");
				let modPacks = await getControl().send(new lib.ModPackListRequest());
				let modPack = modPacks.find(entry => entry.name === "full-pack");
				assert(modPack, "created mod pack not found");
				assert.equal(modPack.factorioVersion, "1.2.0");
			});
		});

		describe("mod-pack delete", function() {
			it("deletes the pack", async function() {
				await execCtl("mod-pack delete full-pack");
				let modPacks = await getControl().send(new lib.ModPackListRequest());
				let modPack = modPacks.find(entry => entry.name === "full-pack");
				assert(!modPack, "mod pack not deleted");
			});
		});

		describe("mod upload", function() {
			it("uploads a mod", async function() {
				await libBuildMod.build({
					build: true,
					pack: true,
					sourceDir: path.join("test", "file", "empty_mod"),
					outputDir: path.join("temp", "test"),
				});
				await execCtl("mod upload empty_mod_1.0.0.zip");
				assert(
					await fs.pathExists(path.join("temp", "test", "mods", "empty_mod_1.0.0.zip")),
					"mod not present in mods directory"
				);
			});
			it("rejects path traversing mods", async function() {
				await libBuildMod.build({
					build: true,
					pack: true,
					sourceDir: path.join("test", "file", "path_traversing_mod"),
					outputDir: path.join("temp", "test"),
					modName: "path_traversing_mod_1.0.0",
				});
				await fs.remove(path.join("temp", "test", "bad_path_mod_1.0.0.zip"));
				await assert.rejects(execCtl("mod upload path_traversing_mod_1.0.0.zip"));
				assert(
					!await fs.pathExists(path.join("temp", "test", "bad_path_mod_1.0.0.zip")),
					"mod executed a path traversal attack",
				);
			});
		});

		describe("mod show", function() {
			it("gives details of a mod", async function() {
				let result = await execCtl("mod show empty_mod 1.0.0");
				let hash = await lib.hashFile(path.join("temp", "test", "mods", "empty_mod_1.0.0.zip"));
				let stat = await fs.stat(path.join("temp", "test", "mods", "empty_mod_1.0.0.zip"));
				assert.equal(
					result.stdout,
					"name: empty_mod\n" +
					"version: 1.0.0\n" +
					"title: An Empty Mod\n" +
					"author: Me\n" +
					"contact: \n" +
					"homepage: \n" +
					"description: An empty mod for testing\n" +
					"factorioVersion: 1.1\n" +
					"dependencies:\n" +
					`size: ${stat.size}\n` +
					`mtimeMs: ${stat.mtimeMs}\n` +
					`sha1: ${hash}\n` +
					`updatedAtMs: ${stat.mtimeMs}\n` +
					"isDeleted: false\n",
				);
			});
		});

		describe("mod list", function() {
			it("shows the list of mods", async function() {
				let result = await execCtl("mod list");
				assert(result.stdout.indexOf("empty_mod") !== -1, "empty_mod is not in the list");
			});
		});

		describe("mod search", function() {
			it("searches the list of mods", async function() {
				let result = await execCtl("mod search 1.1 name:empty_mod");
				assert(result.stdout.indexOf("empty_mod") !== -1, "empty_mod is not in the result");
			});
		});

		describe("mod download", function() {
			it("downloads a mod", async function() {
				await fs.unlink(path.join("temp", "test", "empty_mod_1.0.0.zip"));
				await execCtl("mod download empty_mod 1.0.0");
				assert(
					await fs.pathExists(path.join("temp", "test", "empty_mod_1.0.0.zip")),
					"mod not downloaded to cwd"
				);
			});
		});

		describe("mod delete", function() {
			it("deletes a mod", async function() {
				await execCtl("mod delete empty_mod 1.0.0");
				assert(
					!await fs.pathExists(path.join("temp", "test", "mods", "empty_mod_1.0.0.zip")),
					"mod still present in mods dir"
				);
			});
		});

		describe("modUpdateEventHandler()", function() {
			it("should have triggered for the previous mod updates", function() {
				let eventsToCheck = new Set(["updated", "deleted"]);
				let eventsNotSeen = new Set(eventsToCheck);

				for (let modUpdate of getControl().modUpdates) {
					if (modUpdate.name !== "empty_mod" || modUpdate.version !== "1.0.0") {
						continue;
					}
					if (modUpdate.isDeleted) {
						eventsNotSeen.delete("deleted");
					} else {
						eventsNotSeen.delete("updated");
					}
				}

				assert(eventsNotSeen.size === 0, `Did not see the events ${[...eventsNotSeen]}`);
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
				let roles = await getControl().send(new lib.RoleListRequest());
				let tempRole = roles.find(role => role.name === "temp");
				assert.deepEqual(
					tempRole,
					new lib.Role(5, "temp", "A temp role", new Set(["core.control.connect"]))
				);
			});
		});

		describe("role edit", function() {
			it("should modify the given role", async function() {
				let args = "--name new --description \"A new role\" --set-perms";
				await execCtl(`role edit temp ${args}`);
				let roles = await getControl().send(new lib.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole, new lib.Role(5, "new", "A new role", new Set()));
			});
			it("should add permissions with --add-perms", async function() {
				let args = "--name new --add-perms core.host.list core.instance.list";
				await execCtl(`role edit new ${args}`);
				let roles = await getControl().send(new lib.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, new Set(["core.host.list", "core.instance.list"]));
			});
			it("should remove permissions with --remove-perms", async function() {
				let args = "--name new --remove-perms core.host.list";
				await execCtl(`role edit new ${args}`);
				let roles = await getControl().send(new lib.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, new Set(["core.instance.list"]));
			});
			it("should grant default permissions with --grant-default", async function() {
				await execCtl("role edit new --grant-default");
				let roles = await getControl().send(new lib.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				let defaultPermissions = [...lib.permissions.values()]
					.filter(p => p.grantByDefault)
					.map(p => p.name)
				;
				assert.deepEqual(new Set(newRole.permissions), new Set(defaultPermissions));
			});
		});

		describe("role delete", function() {
			it("should delete the given role", async function() {
				await execCtl("role delete new");
				let roles = await getControl().send(new lib.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
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
				getControl().userUpdates = [];
				await execCtl("user create temp");
				let users = await getControl().send(new lib.UserListRequest());
				let tempUser = users.find(user => user.id === "temp");
				assert(tempUser, "user was not created");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].id, "temp");
			});
		});

		describe("user revoke-token", function() {
			it("should kick existing sessions for the user", async function() {
				slowTest(this);
				await getControl().send(new lib.UserCreateRequest("revokee"));
				let tlsCa = await fs.readFile("test/file/tls/cert.pem");
				let connector = new TestControlConnector(url, 2, tlsCa);
				connector.token = jwt.sign(
					{ aud: "user", user: "revokee" }, Buffer.from("TestSecretDoNotUse", "base64")
				);
				let revokeeControl = new TestControl(connector);
				await connector.connect();
				connector.setClosing();
				let closed = new Promise(resolve => connector.once("close", resolve));

				await execCtl("user revoke-token revokee");

				await closed;
			});
		});

		describe("user set-roles", function() {
			it("should set the roles on the user", async function() {
				getControl().userUpdates = [];
				await execCtl('user set-roles temp "Cluster Admin"');
				let users = await getControl().send(new lib.UserListRequest());
				let tempUser = users.find(user => user.id === "temp");
				assert.deepEqual(tempUser.roleIds, new Set([0]));
				assert.equal(getControl().userUpdates.length, 1);
			});

			it("should restrict actions based on roles", async function() {
				await execCtl('user set-roles temp "Player"');
				let tempControl;
				try {
					let tlsCa = await fs.readFile("test/file/tls/cert.pem");
					let connector = new TestControlConnector(url, 2, tlsCa);
					connector.token = jwt.sign(
						{ aud: "user", user: "temp" }, Buffer.from("TestSecretDoNotUse", "base64")
					);
					tempControl = new TestControl(connector);
					await connector.connect();

					await assert.rejects(
						tempControl.send(new lib.UserCreateRequest("notallowed")),
						new Error("Permission denied")
					);

				} finally {
					await tempControl.connector.disconnect();
				}

				let users = await getUsers();
				assert(!users.has("notallowed"), "user was created when it should not be allowed");
			});
		});

		describe("user delete", function() {
			it("should delete the user", async function() {
				getControl().userUpdates = [];
				await execCtl("user delete temp");
				let users = await getControl().send(new lib.UserListRequest());
				let tempUser = users.find(user => user.id === "temp");
				assert(!tempUser, "user was note deleted");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].isDeleted, true);
			});
		});
	});
});
