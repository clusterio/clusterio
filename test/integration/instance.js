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

		for (const plugin of [
			"global_chat", "research_sync", "statistics_exporter", "subspace_storage", "player_auth", "inventory_sync",
		]) {
			await execCtl(`instance config set ${instName} ${plugin}.load_plugin false`);
		}

		// Create a new alt instance
		await execCtl(`instance create ${instAltName} --id ${instAltId}`);
		await execCtl(`instance config set ${instAltName} factorio.enable_whitelist true`);
		await execCtlProcess(`instance config set-prop ${instAltName} factorio.settings visibility "${visibility}"`);
		await execCtl(`instance config set-prop ${instAltName} factorio.settings require_user_verification false`);
		await execCtl(`instance assign ${instAltName} 4`);
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
