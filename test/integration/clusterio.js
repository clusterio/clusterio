"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");
const events = require("events");
const phin = require("phin");

const libLink = require("@clusterio/lib/link");
const libUsers = require("@clusterio/lib/users");
const { wait } = require("@clusterio/lib/helpers");

const testStrings = require("../lib/factorio/test_strings");
const {
	TestControl, TestControlConnector, url, controlToken, slowTest,
	get, exec, execCtl, sendRcon, getControl, spawn, instancesDir,
} = require("./index");


async function getInstances() {
	let result = await libLink.messages.listInstances.send(getControl());
	return new Map(result.list.map(instance => [instance.id, instance]));
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
	await libLink.messages.deleteSave.send(getControl(), { instance_id: instanceId, save });
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
				connectorA._closing = true;
				connectorA.stopHeartbeat();
				connectorA.on("error", () => {});

				let connectorB = new TestControlConnector(url, 2, tlsCa);
				connectorB.token = controlToken;
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
				let result = await libLink.messages.queryLog.send(getControl(), {
					all: true,
					master: false,
					slave_ids: [],
					instance_ids: [],
					max_level: null,
					limit: 10,
					order: "asc",
				});
				assert.equal(result.log.length, 10);
			});
			it("should return entries by order", async function() {
				let first = await libLink.messages.queryLog.send(getControl(), {
					all: true,
					master: false,
					slave_ids: [],
					instance_ids: [],
					max_level: null,
					limit: 1,
					order: "asc",
				});
				let last = await libLink.messages.queryLog.send(getControl(), {
					all: true,
					master: false,
					slave_ids: [],
					instance_ids: [],
					max_level: null,
					limit: 1,
					order: "desc",
				});
				assert(first.log[0].timestamp < last.log[0].timestamp, "first log entry happened after last");
			});
		});
	});

	describe("clusterioslave", function() {
		describe("slaveUpdateEventHandler()", function() {
			it("should trigger when a new slave is added", async function() {
				// On windows there's currently no way to automate graceful shutdown of the slave
				// process as CTRL+C is some weird terminal thing and SIGINT isn't a thing.
				if (process.platform === "win32") {
					this.skip();
				}

				slowTest(this);
				getControl().slaveUpdates = [];
				let config = "alt-slave-config.json";
				let configPath = path.join("temp", "test", config);
				await fs.remove(configPath);
				await fs.remove(path.join("temp", "test", "alt-instances"));
				await execCtl(`slave create-config --id 5 --name alt-slave --generate-token --output ${config}`);
				await exec(
					`node ../../packages/slave --config ${config} config set slave.tls_ca ../../test/file/tls/cert.pem`
				);
				await exec(
					`node ../../packages/slave --config ${config} config set slave.instances_directory alt-instances`
				);

				let slaveProcess;
				try {
					slaveProcess = await spawn(
						"alt-slave:", `node ../../packages/slave run --config ${config}`, /Started slave/
					);
					// Add instance to test the unknown status afterwards
					await execCtl("instance create alt-test --id 99");
					await execCtl("instance assign alt-test 5");
				} finally {
					if (slaveProcess) {
						slaveProcess.kill("SIGINT");
						await events.once(slaveProcess, "exit");
					}
				}

				let sawUpdate = false;
				let sawConnected = false;
				let sawDisconnected = false;

				for (let update of getControl().slaveUpdates) {
					if (update.name !== "alt-slave") {
						continue;
					}

					sawUpdate = true;
					if (update.connected) {
						sawConnected = true;
					} else {
						sawDisconnected = true;
					}
				}

				assert(sawUpdate, "No slave update was sent");
				assert(sawConnected, "No slave update with status connected was sent");
				assert(sawDisconnected, "No slave update with status disconnected was sent");

				let result = await libLink.messages.listSlaves.send(getControl());
				let slaves = new Map(result.list.map(instance => [instance.id, instance]));
				assert(slaves.has(5), "Slave list was not updated");
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
			it("runs without an id", async function() {
				await execCtl("slave generate-token");
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
				assert.equal(getControl().saveListUpdates.slice(-1)[0].list[0].name, "world.zip");
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
				let response = await get("/api/export-manifest");
				let manifest = JSON.parse(response.body);
				assert(Object.keys(manifest).length > 1, "Export manifest is empty");
				assert(
					await fs.exists(path.join(exportPath, "..", manifest["item-metadata"])),
					"Export was not written to filesystem"
				);
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
				let result = await libLink.messages.listSaves.send(getControl(), { instance_id: 44 });
				let running = result.list.find(s => s.loaded);
				assert(running.name !== "_autosave1.zip");
			});
		});

		describe("instance send-rcon", function() {
			it("sends the command", async function() {
				slowTest(this);
				await execCtl("instance send-rcon test technobabble");
				let { log } = await libLink.messages.queryLog.send(getControl(), {
					all: false,
					master: false,
					slave_ids: [],
					instance_ids: [44],
					max_level: null,
					limit: 10,
					order: "desc",
				});
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
				let result = await libLink.messages.listUsers.send(getControl());
				return new Map(result.list.map(user => [user.name, user]));
			}

			async function getUser(name) {
				return await libLink.messages.getUser.send(getControl(), { name });
			}

			let lists = ["admin", "whitelisted", "banned"];
			it("should add and remove the given user to the list", async function() {
				slowTest(this);
				getControl().userUpdates = [];
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
				assert.equal(getControl().userUpdates.length, 7);
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
				getControl().userUpdates = [];
				for (let list of lists) {
					await execCtl(`user set-${list} --create test_create_${list}`);
					let user = (await getUsers()).get(`test_create_${list}`);
					assert.equal(user && user[`is_${list}`], true, `user not created and added to ${list}`);
				}
				assert.equal(getControl().userUpdates.length, 3);
			});
			it("should send ban reason", async function() {
				slowTest(this);
				getControl().userUpdates = [];
				await execCtl("user set-banned --create test_ban_reason --reason a-reason");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].ban_reason, "a-reason");
				let user = await getUser("test_ban_reason");
				assert.equal(user["ban_reason"], "a-reason");
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
						let slaveProcess;
						before(async function() {
							// On windows there's currently no way to automate graceful shutdown of the slave
							// process as CTRL+C is some weird terminal thing and SIGINT isn't a thing.
							if (process.platform === "win32") {
								this.skip();
							}
							slowTest(this);
							// Reuse from the clusterioslave test
							let config = "alt-slave-config.json";
							slaveProcess = await spawn(
								"alt-slave:", `node ../../packages/slave run --config ${config}`, /Started slave/
							);
						});
						after(async function() {
							if (slaveProcess) {
								slaveProcess.kill("SIGINT");
								await events.once(slaveProcess, "exit");
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
				assert(!instances.has(44), "instance was not deleted from master");
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
				getControl().userUpdates = [];
				await execCtl("user create temp");
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert(tempUser, "user was not created");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].name, "temp");
			});
		});

		describe("user set-roles", function() {
			it("should set the roles on the user", async function() {
				getControl().userUpdates = [];
				await execCtl('user set-roles temp "Cluster Admin"');
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert.deepEqual(tempUser.roles, [0]);
				assert.equal(getControl().userUpdates.length, 1);
			});
		});

		describe("user delete", function() {
			it("should delete the user", async function() {
				getControl().userUpdates = [];
				await execCtl("user delete temp");
				let result = await libLink.messages.listUsers.send(getControl());
				let tempUser = result.list.find(user => user.name === "temp");
				assert(!tempUser, "user was note deleted");
				assert.equal(getControl().userUpdates.length, 1);
				assert.equal(getControl().userUpdates[0].is_deleted, true);
			});
		});
	});
});
