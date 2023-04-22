"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const jwt = require("jsonwebtoken");
const path = require("path");
const events = require("events");
const phin = require("phin");

const libBuildMod = require("@clusterio/lib/build_mod");
const libData = require("@clusterio/lib/data");
const libHash = require("@clusterio/lib/hash");
const libLink = require("@clusterio/lib/link");
const libUsers = require("@clusterio/lib/users");
const { wait } = require("@clusterio/lib/helpers");

const testStrings = require("../lib/factorio/test_strings");
const {
	TestControl, TestControlConnector, url, controlToken, slowTest,
	get, exec, execCtl, sendRcon, getControl, spawn, instancesDir,
} = require("./index");


async function getInstances() {
	let instances = await getControl().send(new libData.InstanceDetailsListRequest());
	return new Map(instances.map(instance => [instance.id, instance]));
}

async function checkInstanceStatus(id, status) {
	let instances = await getInstances();
	assert.equal(instances.get(44).status, status, "incorrect instance status");
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
	await getControl().send(new libData.InstanceDeleteSaveRequest(instanceId, save));
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
				connectorB._startedResuming = Date.now();
				connectorB._state = "resuming";
				connectorB._doConnect();
				await events.once(connectorB, "resume");
				await connectorB.close(1000, "");
			});
		});

		describe("queryLogRequestHandler", function() {
			it("should honnor the limit", async function() {
				let result = await getControl().send(new libData.LogQueryRequest(true, false, [], [], null, 10, "asc"));
				assert.equal(result.log.length, 10);
			});
			it("should return entries by order", async function() {
				let first = await getControl().send(new libData.LogQueryRequest(true, false, [], [], null, 1, "asc"));
				let last = await getControl().send(new libData.LogQueryRequest(true, false, [], [], null, 1, "desc"));
				assert(first.log[0].timestamp < last.log[0].timestamp, "first log entry happened after last");
			});
		});
	});

	describe("clusteriohost", function() {
		describe("hostUpdateEventHandler()", function() {
			it("should trigger when a new host is added", async function() {
				// On windows there's currently no way to automate graceful shutdown of the host
				// process as CTRL+C is some weird terminal thing and SIGINT isn't a thing.
				if (process.platform === "win32") {
					this.skip();
				}

				slowTest(this);
				getControl().hostUpdates = [];
				let config = "alt-host-config.json";
				let configPath = path.join("temp", "test", config);
				await fs.remove(configPath);
				await fs.remove(path.join("temp", "test", "alt-instances"));
				await execCtl(`host create-config --id 5 --name alt-host --generate-token --output ${config}`);
				await exec(
					`node ../../packages/host --config ${config} config set host.tls_ca ../../test/file/tls/cert.pem`
				);
				await exec(
					`node ../../packages/host --config ${config} config set host.instances_directory alt-instances`
				);

				let hostProcess;
				try {
					hostProcess = await spawn(
						"alt-host:", `node ../../packages/host run --config ${config}`, /Started host/
					);
					// Add instance to test the unknown status afterwards
					await execCtl("instance create alt-test --id 99");
					await execCtl("instance assign alt-test 5");
				} finally {
					if (hostProcess) {
						hostProcess.kill("SIGINT");
						await events.once(hostProcess, "exit");
					}
				}

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

				let result = await getControl().send(new libData.HostListRequest());
				let hosts = new Map(result.map(instance => [instance.id, instance]));
				assert(hosts.has(5), "Host list was not updated");
			});
		});
	});

	describe("clusterioctl", function() {
		describe("controller config list", function() {
			it("runs", async function() {
				await execCtl("controller config list");
			});
			it("should not leak auth_secret", async function() {
				let result = await getControl().send(new libData.ControllerConfigGetRequest());
				let done = false;
				for (let group of result.serializedConfig.groups) {
					if (group.name === "controller") {
						assert.equal(Object.prototype.hasOwnProperty.call(group.fields, "auth_secret"), false);
						done = true;
						break;
					}
				}
				assert(done, "controller group not found");
			});
		});
		describe("controller config set", function() {
			it("sets given config option", async function() {
				await execCtl('controller config set controller.name "Test Cluster"');
				let result = await getControl().send(new libData.ControllerConfigGetRequest());
				let done = false;
				for (let group of result.serializedConfig.groups) {
					if (group.name === "controller") {
						assert.equal(group.fields.name, "Test Cluster");
						done = true;
						break;
					}
				}
				assert(done, "controller group not found");
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
		describe("host generate-token", function() {
			it("runs", async function() {
				await execCtl("host generate-token --id 42");
			});
			it("runs without an id", async function() {
				await execCtl("host generate-token");
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
				await execCtl(`instance config set-prop test factorio.settings visibility "'${value}'"`);
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
				getControl().saveListUpdates = [];
				await execCtl("instance save create test");
				await checkInstanceStatus(44, "stopped");
			});
		});

		describe("saveListUpdateEventHandler()", function() {
			it("should have triggered for the created save", function() {
				slowTest(this);
				assert.equal(getControl().saveListUpdates.slice(-1)[0].saves[0].name, "world.zip");
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
				let modPack = await getControl().send(new libData.ModPackGetDefaultRequest());
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
				let saves = await getControl().sendTo(new libData.InstanceListSavesRequest(), { instanceId: 44 });
				let running = saves.find(s => s.loaded);
				assert(running.name !== "_autosave1.zip");
			});
		});

		describe("instance send-rcon", function() {
			it("sends the command", async function() {
				slowTest(this);
				await execCtl("instance send-rcon test technobabble");
				let { log } = await getControl().send(
					new libData.LogQueryRequest(false, false, [], [44], null, 10, "desc")
				);
				assert(log.some(info => /technobabble/.test(info.message)), "Command was not sent");
			});

			it("should trigger saveListUpdate on save", async function() {
				slowTest(this);
				getControl().saveListUpdates = [];
				await execCtl("instance send-rcon test /server-save");
				let received = false;
				for (let x = 0; x < 10; x++) {
					if (getControl().saveListUpdates.length) {
						received = true;
						break;
					}
					await wait(100);
				}
				assert(received, "saveListUpdate not sent");
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
				let users = await getControl().send(new libData.UserListRequest());
				return new Map(users.map(user => [user.name, user]));
			}

			async function getUser(name) {
				return await getControl().send(new libData.UserGetRequest(name));
			}

			let lists = [["admin", "isAdmin"], ["whitelisted", "isWhitelisted"], ["banned", "isBanned"]];
			it("should add and remove the given user to the list", async function() {
				slowTest(this);
				getControl().userUpdates = [];
				await getControl().send(new libData.UserCreateRequest("list_test"));
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
				await execCtl("instance delete spam");
			});
			for (let remote of [false, true]) {
				let pri = 44;
				let sec = remote ? 99 : 66;
				let priSaves = path.join("temp", "test", "instances", "test", "saves");
				let secSaves = remote
					? path.join("temp", "test", "alt-instances", "alt-test", "saves")
					: path.join("temp", "test", "instances", "spam", "saves")
				;
				describe(remote ? "remote" : "local", function() {
					if (remote) {
						let hostProcess;
						before(async function() {
							// On windows there's currently no way to automate graceful shutdown of the host
							// process as CTRL+C is some weird terminal thing and SIGINT isn't a thing.
							if (process.platform === "win32") {
								this.skip();
							}
							slowTest(this);
							// Reuse from the clusteriohost test
							let config = "alt-host-config.json";
							hostProcess = await spawn(
								"alt-host:", `node ../../packages/host run --config ${config}`, /Started host/
							);
						});
						after(async function() {
							if (hostProcess) {
								hostProcess.kill("SIGINT");
								await events.once(hostProcess, "exit");
							}
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
				await execCtl("instance delete test");
				assert(!await fs.exists(path.join(instancesDir, "test")), "Instance files was not deleted");
				let instances = await getInstances();
				assert(!instances.has(44), "instance was not deleted from controller");
			});
		});

		describe("instanceUpdateEventHandler()", function() {
			it("should have triggered for the previous instance status updates", function() {
				let statusesToCheck = new Set([
					"unassigned", "unknown", "stopped", "creating_save", "exporting_data",
					"starting", "running", "stopping", "deleted",
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
				let modPacks = await getControl().send(new libData.ModPackListRequest());
				assert(modPacks.some(modPack => modPack.name === "empty-pack"), "created pack is not in the list");
			});
			it("should allow setting all fields", async function() {
				await execCtl(
					"mod-pack create full-pack 0.17.59 " +
					"--description Description " +
					"--mods empty_mod:1.0.0 " +
					"--bool-setting startup MyBool true " +
					"--int-setting runtime-global MyInt 1235 " +
					"--double-setting runtime-global MyDouble 12.25 " +
					"--string-setting runtime-per-user MyString a-string"
				);
				let modPacks = await getControl().send(new libData.ModPackListRequest());
				let modPack = modPacks.find(entry => entry.name === "full-pack");
				assert(modPack, "created mod pack not found");
				let reference = libData.ModPack.fromJSON({});
				reference.id = modPack.id;
				reference.name = "full-pack";
				reference.description = "Description";
				reference.factorioVersion = "0.17.59";
				reference.mods.set("empty_mod", { name: "empty_mod", enabled: true, version: "1.0.0" });
				reference.settings["startup"].set("MyBool", { value: true });
				reference.settings["runtime-global"].set("MyInt", { value: 1235 });
				reference.settings["runtime-global"].set("MyDouble", { value: 12.25 });
				reference.settings["runtime-per-user"].set("MyString", { value: "a-string" });
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
				let reference = libData.ModPack.fromJSON({});
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
				const roundtrip = libData.ModPack.fromModPackString(result.stdout.trim());
				roundtrip.id = reference.id;
				assert.deepEqual(roundtrip, reference);
			});
		});

		describe("mod-pack edit", function() {
			it("runs", async function() {
				await execCtl("mod-pack edit full-pack --factorio-version 1.2.0");
				let modPacks = await getControl().send(new libData.ModPackListRequest());
				let modPack = modPacks.find(entry => entry.name === "full-pack");
				assert(modPack, "created mod pack not found");
				assert.equal(modPack.factorioVersion, "1.2.0");
			});
		});

		describe("mod-pack delete", function() {
			it("deletes the pack", async function() {
				await execCtl("mod-pack delete full-pack");
				let modPacks = await getControl().send(new libData.ModPackListRequest());
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
		});

		describe("mod show", function() {
			it("gives details of a mod", async function() {
				let result = await execCtl("mod show empty_mod 1.0.0");
				let hash = await libHash.hashFile(path.join("temp", "test", "mods", "empty_mod_1.0.0.zip"));
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
					`sha1: ${hash}\n` +
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
				let roles = await getControl().send(new libData.RoleListRequest());
				let tempRole = roles.find(role => role.name === "temp");
				assert.deepEqual(
					tempRole,
					new libData.RawRole(5, "temp", "A temp role", ["core.control.connect"])
				);
			});
		});

		describe("role edit", function() {
			it("should modify the given role", async function() {
				let args = "--name new --description \"A new role\" --set-perms";
				await execCtl(`role edit temp ${args}`);
				let roles = await getControl().send(new libData.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole, new libData.RawRole(5, "new", "A new role", []));
			});
			it("should add permissions with --add-perms", async function() {
				let args = "--name new --add-perms core.host.list core.instance.list";
				await execCtl(`role edit new ${args}`);
				let roles = await getControl().send(new libData.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, ["core.host.list", "core.instance.list"]);
			});
			it("should remove permissions with --remove-perms", async function() {
				let args = "--name new --remove-perms core.host.list";
				await execCtl(`role edit new ${args}`);
				let roles = await getControl().send(new libData.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
				assert.deepEqual(newRole.permissions, ["core.instance.list"]);
			});
			it("should grant default permissions with --grant-default", async function() {
				await execCtl("role edit new --grant-default");
				let roles = await getControl().send(new libData.RoleListRequest());
				let newRole = roles.find(role => role.name === "new");
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
				let roles = await getControl().send(new libData.RoleListRequest());
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
				let users = await getControl().send(new libData.UserListRequest());
				let tempUser = users.find(user => user.name === "temp");
				assert(tempUser, "user was not created");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].name, "temp");
			});
		});

		describe("user revoke-token", function() {
			it("should kick existing sessions for the user", async function() {
				slowTest(this);
				await getControl().send(new libData.UserCreateRequest("revokee"));
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
				let users = await getControl().send(new libData.UserListRequest());
				let tempUser = users.find(user => user.name === "temp");
				assert.deepEqual(tempUser.roles, [0]);
				assert.equal(getControl().userUpdates.length, 1);
			});
		});

		describe("user delete", function() {
			it("should delete the user", async function() {
				getControl().userUpdates = [];
				await execCtl("user delete temp");
				let users = await getControl().send(new libData.UserListRequest());
				let tempUser = users.find(user => user.name === "temp");
				assert(!tempUser, "user was note deleted");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].isDeleted, true);
			});
		});
	});
});
