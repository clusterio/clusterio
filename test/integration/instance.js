"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const {
	slowTest, exec, execCtl, execCtlProcess, sendRcon, getControl,
} = require("./index");

const instId = 48;
const instName = "Integration";
const instAltId = 49;
const instAltName = "IntegrationAlt";

const requireApi = [
	"local api =",
	"package.loaded['modules/clusterio/api']", // 1.1.110
	"or package.loaded['__level__/modules/clusterio/api.lua']", // 2.0.0
].join(" ");

function getUser(name) {
	return getControl().send(new lib.UserGetRequest(name));
}

describe("Clusterio Instance", function() {
	before(async function() {
		this.timeout(20000);
		const visibility = JSON.stringify({ lan: true, public: false }).replace(
			/"/g, process.platform === "win32" ? '""' : '\\"'
		);

		// Create a new instance
		await execCtl(`instance create ${instName} --id ${instId}`);
		await execCtl(`instance config set ${instName} factorio.enable_whitelist true`);
		await execCtlProcess(`instance config set-prop ${instName} factorio.settings visibility "${visibility}"`);
		await execCtl(`instance config set-prop ${instName} factorio.settings require_user_verification false`);
		await execCtl(`instance assign ${instName} 4`);
		// Exclude main test instance from start-all to prevent interference
		await execCtl(`instance config set ${instName} instance.exclude_from_start_all true`);

		for (const plugin of [
			"global_chat", "research_sync", "statistics_exporter", "subspace_storage", "player_auth", "inventory_sync",
			"minimap",
		]) {
			await execCtl(`instance config set ${instName} ${plugin}.load_plugin false`);
		}

		// Create a new alt instance
		await execCtl(`instance create ${instAltName} --id ${instAltId}`);
		await execCtl(`instance config set ${instAltName} factorio.enable_whitelist true`);
		await execCtlProcess(`instance config set-prop ${instAltName} factorio.settings visibility "${visibility}"`);
		await execCtl(`instance config set-prop ${instAltName} factorio.settings require_user_verification false`);
		await execCtl(`instance assign ${instAltName} 4`);
		// Exclude alt test instance from start-all to prevent interference
		await execCtl(`instance config set ${instAltName} instance.exclude_from_start_all true`);
		await execCtl(`instance start ${instAltName}`);
		await sendRcon(instAltId, "/sc disable achievements");
	});
	after(async function() {
		this.timeout(20000);
		// Delete the instances
		await execCtl(`instance delete ${instName}`);
		await execCtl(`instance stop ${instAltName}`);
		await execCtl(`instance delete ${instAltName}`);
	});
	for (const savePatchingEnabled of [true, false]) {
		describe(`Integration ${savePatchingEnabled ? "with" : "without"} save patching`, function() {
			before(async function() {
				this.timeout(20000);
				// Create and start a patched save
				await execCtl(`instance config set ${instName} factorio.enable_save_patching ${savePatchingEnabled}`);
				await execCtl(`instance save create ${instName} ${savePatchingEnabled ? "patched" : "unpatched"}`);
				await execCtl(`instance start ${instName} --save ${savePatchingEnabled ? "patched" : "unpatched"}.zip`);
				await sendRcon(instId, "/sc disable achievements");
			});
			after(async function() {
				// Stop the instance
				await execCtl(`instance stop ${instName}`);
			});
			describe("player event", function() {
				if (savePatchingEnabled) {
					// IPC expects save patching to be enabled
					it("should do nothing for an unknown type", async function() {
						await assert.rejects(getUser("DoesNotExist"), "User should not exist");
						await sendRcon(instId,
							`/sc ${requireApi} api.send_json("player_event",` +
							"{ type='invalid type', name='DoesNotExist' })"
						);
						await assert.rejects(getUser("DoesNotExist"), "User was created");
					});
					it("should respond to a player join and leave event", async function() {
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
					await execCtl(`instance config set ${instName} factorio.sync_banlist bidirectional`);
					await sendRcon(instId, "/ban BannedPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userBanned = await getUser("BannedPlayer");
					assert(userBanned.isBanned, "Player is not banned");
					const isAltBanned = await sendRcon(instAltId, "/banlist get BannedPlayer");
					assert.equal(isAltBanned, "BannedPlayer is banned.\n", "User is not banned on alt");

					await sendRcon(instId, "/unban BannedPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userUnbanned = await getUser("BannedPlayer");
					assert(!userUnbanned.isBanned, "Player is not unbanned");
					const isAltUnbanned = await sendRcon(instAltId, "/banlist get BannedPlayer");
					assert.equal(isAltUnbanned, "BannedPlayer is not banned.\n", "User is not unbanned on alt");
				});
				it("should respond to a player promote and demote event", async function() {
					// Because there is no admin list command this test will be different to the other two
					await execCtl(`instance config set ${instName} factorio.sync_adminlist bidirectional`);
					await sendRcon(instId, "/promote AdminPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userPromote = await getUser("AdminPlayer");
					assert(userPromote.isAdmin, "Player is not promoted");
					const isAltPromoted = await sendRcon(instAltId, "/promote AdminPlayer");
					assert.equal(isAltPromoted,
						"AdminPlayer is already in the admin list and will be promoted upon joining the game.\n",
						"User is not promoted on alt"
					);

					await sendRcon(instId, "/demote AdminPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userDemote = await getUser("AdminPlayer");
					assert(!userDemote.isAdmin, "Player is not demoted");
					const isAltDemoted = await sendRcon(instAltId, "/demote AdminPlayer");
					assert.equal(isAltDemoted,
						"AdminPlayer is not in the admin list.\n",
						"User is not demoted on alt"
					);
				});
				it("should respond to a player whitelist add and remove event", async function() {
					await execCtl(`instance config set ${instName} factorio.sync_whitelist bidirectional`);
					await sendRcon(instId, "/whitelist add WhitelistPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userAdded = await getUser("WhitelistPlayer");
					assert(userAdded.isWhitelisted, "Player is not whitelisted");
					const isAltAdded = await sendRcon(instAltId, "/whitelist get WhitelistPlayer");
					assert.equal(isAltAdded,
						"WhitelistPlayer is whitelisted.\n",
						"User is not whitelisted on alt"
					);

					await sendRcon(instId, "/whitelist remove WhitelistPlayer");
					await lib.wait(15); // Propagation time, 10ms worked for me, so i made it 15ms
					const userRemoved = await getUser("WhitelistPlayer");
					assert(!userRemoved.isWhitelisted, "Player is not unwhitelisted");
					const isAltRemoved = await sendRcon(instAltId, "/whitelist get WhitelistPlayer");
					assert.equal(isAltRemoved,
						"WhitelistPlayer is not whitelisted.\n",
						"User is not unwhitelisted on alt"
					);
				});
			});
		});
	}
});
describe("start-all and stop-all commands", function() {
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

		// Exclude testInstName3 from start-all by default
		await execCtl(`instance config set ${testInstName3} instance.exclude_from_start_all true`);

		// Disable plugins to speed up testing
		for (const instanceName of [testInstName1, testInstName2, testInstName3]) {
			for (const plugin of [
				"global_chat", "research_sync", "statistics_exporter",
				"subspace_storage", "player_auth", "inventory_sync",
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
