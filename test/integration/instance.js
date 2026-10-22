import path from "node:path";
import dgram from "node:dgram";
import events from "node:events";
import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import fs from "node:fs/promises";

import { slowTest, testMatrix } from "../common.js";
import {
	execCtl, execCtlProcess, sendRcon, getControl,
	requiresFactorio, hasFactorio, getFactorioVersion, instancesDir,
} from "./index.js";

import { getTestRconPort } from "./rcon_port.js";

const instId = 48;
const instName = "Integration";
const instSetConfig = `instance config set ${instName}`;
const instAltId = 49;
const instAltName = "IntegrationAlt";

const requireApi = [
	"local api =",
	"package.loaded['modules/clusterio/api']", // 1.1.110
	"or package.loaded['__level__/modules/clusterio/api.lua']", // 2.0.0
].join(" ");

// Lua UDP needs Factorio 2.1.10, see docs/configuration.md
function hasLuaUdp() {
	return lib.integerFullVersion(getFactorioVersion()) >= lib.integerFullVersion("2.1.10");
}

async function freeUdpPort() {
	const socket = dgram.createSocket("udp4");
	await events.once(socket.bind(0, "127.0.0.1"), "listening");
	const port = socket.address().port;
	socket.close();
	return port;
}

function getUser(name) {
	return getControl().send(new lib.UserGetRequest(name));
}

// RCON completion does not acknowledge list replication. In particular, whitelist
// updates pass through an asynchronous file watcher before being broadcast.
async function waitForAssertion(check, timeoutMs = 5000) {
	const deadline = performance.now() + timeoutMs;
	for (;;) {
		try {
			await check();
			return;
		} catch (err) {
			if (!(err instanceof assert.AssertionError) || performance.now() >= deadline) {
				throw err;
			}
		}
		await lib.wait(25);
	}
}

async function waitForUserFlag(name, flag, expected, message) {
	await waitForAssertion(async () => {
		// The initial event also creates the user, so absence is a pending state.
		const users = await getControl().send(new lib.UserListRequest());
		const user = users.find(entry => entry.name.toLowerCase() === name.toLowerCase());
		assert(user, `User ${name} has not been created`);
		assert.equal(user[flag], expected, message);
	});
}

async function waitForAltAdmin(expected, message) {
	await waitForAssertion(async () => {
		// Read Factorio's persisted list before checking /promote or /demote
		// responses, so the checks cannot apply a change that has not replicated yet.
		const json = await fs.readFile(path.join(instancesDir, instAltName, "server-adminlist.json"), "utf8");
		let admins;
		// A concurrent write can leave a partial document; retry that observation.
		assert.doesNotThrow(() => { admins = JSON.parse(json); }, "Invalid admin list JSON");
		assert(Array.isArray(admins), "Admin list is not an array");
		assert.equal(admins.some(name => name.toLowerCase() === "adminplayer"), expected, message);
	});
}

describe("Clusterio Instance", function() {
	requiresFactorio(this);
	before(async function() {
		this.timeout(20000);
		const visibility = JSON.stringify({ lan: true, public: false }).replace(
			/"/g, process.platform === "win32" ? '""' : '\\"'
		);

		// Create a new instance
		await execCtl(`instance create ${instName} --id ${instId}`);
		await execCtl(`instance config set ${instName} factorio.rcon_port ${await getTestRconPort()}`);
		await execCtl(`instance config set ${instName} factorio.enable_whitelist true`);
		await execCtlProcess(`instance config set-prop ${instName} factorio.settings visibility "${visibility}"`);
		await execCtl(`instance config set-prop ${instName} factorio.settings require_user_verification false`);
		await execCtl(`instance assign ${instName} 4`);
		// Exclude main test instance from start-all to prevent interference
		await execCtl(`instance config set ${instName} instance.exclude_from_start_all true`);

		for (const plugin of [
			"global_chat", "research_sync", "statistics_exporter", "subspace_storage", "player_auth", "player_sync",
		]) {
			await execCtl(`instance config set ${instName} ${plugin}.load_plugin false`);
		}

		// Create a new alt instance
		await execCtl(`instance create ${instAltName} --id ${instAltId}`);
		await execCtl(`instance config set ${instAltName} factorio.rcon_port ${await getTestRconPort()}`);
		await execCtl(`instance config set ${instAltName} factorio.enable_whitelist true`);
		await execCtlProcess(`instance config set-prop ${instAltName} factorio.settings visibility "${visibility}"`);
		await execCtl(`instance config set-prop ${instAltName} factorio.settings require_user_verification false`);
		await execCtl(`instance assign ${instAltName} 4`);
		// Exclude alt test instance from start-all to prevent interference
		await execCtl(`instance config set ${instAltName} instance.exclude_from_start_all true`);
		await execCtl(`instance start ${instAltName}`);
	});
	after(async function() {
		if (!hasFactorio()) {
			return;
		}
		this.timeout(20000);
		// Delete the instances
		await execCtl(`instance delete ${instName}`);
		await execCtl(`instance stop ${instAltName}`);
		await execCtl(`instance delete ${instAltName}`);
	});
	describe("whitelist creation", function() {
		const whitelistPath = path.join(instancesDir, instName, "server-whitelist.json");
		before(async function() {
			this.timeout(20000);
			await execCtl(`${instSetConfig} factorio.sync_whitelist disabled`);
			await execCtl(`${instSetConfig} factorio.enable_whitelist false`);
		});
		afterEach(async function() {
			this.timeout(20000);
			await execCtl(`instance stop ${instName}`);
		});
		it("should always create a whitelist json even if unused", async function() {
			slowTest(this);
			await fs.rm(whitelistPath, { force: true });
			await execCtl(`instance start ${instName}`);
			const whitelist = JSON.parse(await fs.readFile(whitelistPath, "utf8"));
			assert.deepEqual(whitelist, []);
		});
		it("should not overwrite the existing whitelist if sync is disabled", async function() {
			slowTest(this);
			await fs.writeFile(whitelistPath, JSON.stringify(["test_user"]));
			await execCtl(`instance start ${instName}`);
			const whitelist = JSON.parse(await fs.readFile(whitelistPath, "utf8"));
			assert.deepEqual(whitelist, ["test_user"]);
		});
	});
	for (const [savePatchingEnabled, scriptCommandsEnabled] of testMatrix([true, false], [true, false])) {
		const strSavePatching = `save patching: ${savePatchingEnabled ? "Enabled" : "Disabled"}`;
		const strScriptCommands = `script commands: ${scriptCommandsEnabled ? "Enabled" : "Disabled"}`;
		async function allowSendingScriptCommands() {
			if (!scriptCommandsEnabled) {
				// Enable command to prevent "Attempted to use script command when disabled"
				// This works because we only disable achievements on startup, this will break if we make it live update
				await execCtl(`${instSetConfig} factorio.enable_script_commands true`);
			}
		}
		describe(`Integration - ${strSavePatching}, ${strScriptCommands}`, function() {
			let luaUdpPort;
			before(async function() {
				this.timeout(20000);
				// Create and start a patched save
				await execCtl(`${instSetConfig} factorio.enable_whitelist true`);
				await execCtl(`${instSetConfig} factorio.enable_save_patching ${savePatchingEnabled}`);
				await execCtl(`${instSetConfig} factorio.enable_script_commands ${scriptCommandsEnabled}`);
				await execCtl(`${instSetConfig} factorio.enable_lua_udp ${hasLuaUdp()}`);
				luaUdpPort = await freeUdpPort();
				await execCtl(`${instSetConfig} factorio.lua_udp_port ${luaUdpPort}`);
				await execCtl(`instance save create ${instName}`);
				await execCtl(`instance start ${instName}`);
			});
			after(async function() {
				// Stop the instance
				await execCtl(`instance stop ${instName}`);
			});
			describe("Disable achievements", function() {
				it("should only disable achievements when script commands are enabled", async function() {
					await allowSendingScriptCommands();
					const res = await sendRcon(instId, "/sc rcon.print('Disabled')");
					assert.equal(res === "Disabled\n", scriptCommandsEnabled);
				});
			});
			if (savePatchingEnabled) {
				describe("Lua UDP", function() {
					it("should drop send_udp before the module is initialised", async function() {
						// Mods can call send_udp from on_init, before the first tick sets up script data
						await allowSendingScriptCommands();
						const res = await sendRcon(instId,
							`/sc ${requireApi} local data = storage or global ` +
							"local saved = data.clusterio data.clusterio = nil " +
							"local module_ok = pcall(api.send_udp, 'early', 'data') " +
							"local mod_ok, port = pcall(remote.call, 'clusterio_api', 'get_host_udp_port') " +
							"data.clusterio = saved " +
							"rcon.print(tostring(module_ok) .. ' ' .. tostring(mod_ok) .. ' ' .. tostring(port))"
						);
						assert.equal(res, "true true nil\n");
					});
					it("should dispatch packets sent to the game", async function() {
						if (!hasLuaUdp()) {
							this.skip();
						}
						await allowSendingScriptCommands();
						await sendRcon(instId,
							"/sc script.on_event(defines.events.on_udp_packet_received, " +
							"function(event) storage.udp_test = event.payload end)"
						);
						const socket = dgram.createSocket("udp4");
						let payload;
						try {
							for (let i = 0; i < 10 && payload !== "hello\n"; i++) {
								socket.send("hello", luaUdpPort, "127.0.0.1");
								await lib.wait(10);
								// The server does not tick without players, commands make it tick
								payload = await sendRcon(instId, "/sc rcon.print(tostring(storage.udp_test))");
							}
						} finally {
							socket.close();
						}
						assert.equal(payload, "hello\n");
					});
				});
			}
			describe("Player events", function() {
				if (savePatchingEnabled) {
					// IPC expects save patching to be enabled
					it("should do nothing for an unknown type", async function() {
						await assert.rejects(getUser("DoesNotExist"), "User should not exist");
						await allowSendingScriptCommands();
						await sendRcon(instId,
							`/sc ${requireApi} api.send_json("player_event",` +
							"{ type='invalid type', name='DoesNotExist' })"
						);
						await assert.rejects(getUser("DoesNotExist"), "User was created");
					});
					it("should respond to a player join and leave event", async function() {
						await allowSendingScriptCommands();
						await sendRcon(instId,
							`/sc ${requireApi} api.send_json("player_event",` +
							"{ type='join', name='JoiningPlayer' })"
						);
						const userJoin = await getUser("JoiningPlayer");
						assert(userJoin.instances.has(instId), "Player is not shown as online");
						await sendRcon(instId,
							`/sc ${requireApi} api.send_json("player_event",` +
							"{ type='leave', name='JoiningPlayer', reason='quit' })"
						);
						const userLeave = await getUser("JoiningPlayer");
						assert(!userLeave.instances.has(instId), "Player is not shown as offline");
					});
				}
				it("should respond to a player ban and unban event", async function() {
					this.timeout(25000);
					await execCtl(`${instSetConfig} factorio.sync_banlist bidirectional`);
					await sendRcon(instId, "/ban BannedPlayer");
					await waitForUserFlag("BannedPlayer", "isBanned", true, "Player is not banned");
					await waitForAssertion(async () => {
						const isAltBanned = await sendRcon(instAltId, "/banlist get BannedPlayer");
						assert.equal(isAltBanned, "BannedPlayer is banned.\n", "User is not banned on alt");
					});

					await sendRcon(instId, "/unban BannedPlayer");
					await waitForUserFlag("BannedPlayer", "isBanned", false, "Player is not unbanned");
					await waitForAssertion(async () => {
						const isAltUnbanned = await sendRcon(instAltId, "/banlist get BannedPlayer");
						assert.equal(isAltUnbanned, "BannedPlayer is not banned.\n", "User is not unbanned on alt");
					});
				});
				it("should respond to a player promote and demote event", async function() {
					this.timeout(25000);
					await execCtl(`${instSetConfig} factorio.sync_adminlist bidirectional`);
					await sendRcon(instId, "/promote AdminPlayer");
					await waitForUserFlag("AdminPlayer", "isAdmin", true, "Player is not promoted");
					await waitForAltAdmin(true, "User is not promoted on alt");
					const isAltPromoted = await sendRcon(instAltId, "/promote AdminPlayer");
					assert.equal(isAltPromoted,
						"AdminPlayer is already in the admin list and will be promoted upon joining the game.\n",
						"User is not promoted on alt"
					);

					await sendRcon(instId, "/demote AdminPlayer");
					await waitForUserFlag("AdminPlayer", "isAdmin", false, "Player is not demoted");
					await waitForAltAdmin(false, "User is not demoted on alt");
					const isAltDemoted = await sendRcon(instAltId, "/demote AdminPlayer");
					assert.equal(isAltDemoted,
						"AdminPlayer is not in the admin list.\n",
						"User is not demoted on alt"
					);
				});
				it("should respond to a player whitelist add and remove event", async function() {
					this.timeout(25000);
					await execCtl(`${instSetConfig} factorio.sync_whitelist bidirectional`);
					await sendRcon(instId, "/whitelist add WhitelistPlayer");
					await waitForUserFlag("WhitelistPlayer", "isWhitelisted", true, "Player is not whitelisted");
					await waitForAssertion(async () => {
						const isAltAdded = await sendRcon(instAltId, "/whitelist get WhitelistPlayer");
						assert.equal(isAltAdded,
							"WhitelistPlayer is whitelisted.\n",
							"User is not whitelisted on alt"
						);
					});

					await sendRcon(instId, "/whitelist remove WhitelistPlayer");
					await waitForUserFlag("WhitelistPlayer", "isWhitelisted", false, "Player is not unwhitelisted");
					await waitForAssertion(async () => {
						const isAltRemoved = await sendRcon(instAltId, "/whitelist get WhitelistPlayer");
						assert.equal(isAltRemoved,
							"WhitelistPlayer is not whitelisted.\n",
							"User is not unwhitelisted on alt"
						);
					});
				});
			});
		});
	}
});
describe("start-all and stop-all commands", function() {
	requiresFactorio(this);
	// Test instance IDs for start-all/stop-all tests
	const testInstId1 = 50;
	const testInstId2 = 51;
	const testInstId3 = 52;
	const testInstName1 = "StartAllTest1";
	const testInstName2 = "StartAllTest2";
	const testInstName3 = "StartAllTest3";

	before(async function() {
		this.timeout(30000);

		// Create test instances for start-all/stop-all testing
		await execCtl(`instance create ${testInstName1} --id ${testInstId1}`);
		await execCtl(`instance create ${testInstName2} --id ${testInstId2}`);
		await execCtl(`instance create ${testInstName3} --id ${testInstId3}`);

		// Configure instances
		await execCtl(`instance assign ${testInstName1} 4`);
		await execCtl(`instance assign ${testInstName2} 4`);
		await execCtl(`instance assign ${testInstName3} 4`);
		const visibility = JSON.stringify({ lan: false, public: false }).replace(
			/"/g, process.platform === "win32" ? '""' : '\\"'
		);
		for (const name of [testInstName1, testInstName2, testInstName3]) {
			await execCtl(`instance config set ${name} factorio.rcon_port ${await getTestRconPort()}`);
			await execCtlProcess(`instance config set-prop ${name} factorio.settings visibility "${visibility}"`);
			await execCtl(`instance config set-prop ${name} factorio.settings require_user_verification false`);
		}

		// Exclude testInstName3 from start-all by default
		await execCtl(`instance config set ${testInstName3} instance.exclude_from_start_all true`);

		// Disable plugins to speed up testing
		for (const instanceName of [testInstName1, testInstName2, testInstName3]) {
			for (const plugin of [
				"global_chat", "research_sync", "statistics_exporter",
				"subspace_storage", "player_auth", "player_sync",
			]) {
				await execCtl(`instance config set ${instanceName} ${plugin}.load_plugin false`);
			}
		}
	});

	after(async function() {
		this.timeout(30000);
		// Clean up test instances - ensure they are stopped first
		await execCtl(`instance stop ${testInstName1}`).catch(() => {});
		await execCtl(`instance stop ${testInstName2}`).catch(() => {});
		await execCtl(`instance stop ${testInstName3}`).catch(() => {});

		await execCtl(`instance delete ${testInstName1}`).catch(() => {});
		await execCtl(`instance delete ${testInstName2}`).catch(() => {});
		await execCtl(`instance delete ${testInstName3}`).catch(() => {});
	});

	async function getInstanceStatus(id) {
		const instances = await getControl().send(new lib.InstanceDetailsListRequest());
		const instanceMap = new Map(instances.map(instance => [instance.id, instance]));
		return instanceMap.get(id)?.status;
	}

	describe("start-all command", function() {
		beforeEach(async function() {
			this.timeout(15000);
			// Ensure all test instances are stopped before each test
			await execCtl(`instance stop ${testInstName1}`).catch(() => {});
			await execCtl(`instance stop ${testInstName2}`).catch(() => {});
			await execCtl(`instance stop ${testInstName3}`).catch(() => {});
		});

		afterEach(async function() {
			this.timeout(15000);
			// Clean up: stop any instances that were started during tests
			await execCtl(`instance stop ${testInstName1}`).catch(() => {});
			await execCtl(`instance stop ${testInstName2}`).catch(() => {});
			await execCtl(`instance stop ${testInstName3}`).catch(() => {});
		});

		it("starts only stopped instances that are not excluded by default", async function() {
			this.timeout(20000);
			// Start one instance to verify it's not started again
			await execCtl(`instance start ${testInstName2}`);

			// Verify initial state
			assert.equal(await getInstanceStatus(testInstId1), "stopped");
			assert.equal(await getInstanceStatus(testInstId2), "running");
			assert.equal(await getInstanceStatus(testInstId3), "stopped");

			// Run start-all without force
			await execCtl("instance start-all");

			// Verify results - only testInstName1 should be started
			// testInstName2 was already running, testInstName3 is excluded
			assert.equal(await getInstanceStatus(testInstId1), "running");
			assert.equal(await getInstanceStatus(testInstId2), "running");
			assert.equal(await getInstanceStatus(testInstId3), "stopped");
		});

		it("starts excluded instances when --force flag is provided", async function() {
			this.timeout(20000);
			// Verify initial state - all stopped
			assert.equal(await getInstanceStatus(testInstId1), "stopped");
			assert.equal(await getInstanceStatus(testInstId2), "stopped");
			assert.equal(await getInstanceStatus(testInstId3), "stopped");

			// Run start-all with force
			await execCtl("instance start-all --force");

			// Verify results - all instances should be started including excluded one
			assert.equal(await getInstanceStatus(testInstId1), "running");
			assert.equal(await getInstanceStatus(testInstId2), "running");
			assert.equal(await getInstanceStatus(testInstId3), "running");
		});
	});

	describe("stop-all command", function() {
		beforeEach(async function() {
			this.timeout(15000);
			// Ensure a known state before each test
			await execCtl(`instance stop ${testInstName1}`).catch(() => {});
			await execCtl(`instance stop ${testInstName2}`).catch(() => {});
			await execCtl(`instance stop ${testInstName3}`).catch(() => {});
		});

		afterEach(async function() {
			this.timeout(15000);
			// Clean up: stop any instances that were started during tests
			await execCtl(`instance stop ${testInstName1}`).catch(() => {});
			await execCtl(`instance stop ${testInstName2}`).catch(() => {});
			await execCtl(`instance stop ${testInstName3}`).catch(() => {});
		});

		it("stops only running or starting instances", async function() {
			this.timeout(20000);
			// Start some instances to test stop-all
			await execCtl(`instance start ${testInstName1}`);
			await execCtl(`instance start ${testInstName3}`);

			// Verify initial state
			assert.equal(await getInstanceStatus(testInstId1), "running");
			assert.equal(await getInstanceStatus(testInstId2), "stopped");
			assert.equal(await getInstanceStatus(testInstId3), "running");

			await execCtl("instance stop-all");

			// Verify results - running instances should be stopped, stopped ones unchanged
			assert.equal(await getInstanceStatus(testInstId1), "stopped");
			assert.equal(await getInstanceStatus(testInstId2), "stopped");
			assert.equal(await getInstanceStatus(testInstId3), "stopped");
		});
	});
});
