"use strict";
const fs = require("fs-extra");
const assert = require("assert").strict;
const { PlayerStats } = require("@clusterio/lib");
const { ControllerUser, UserManager } = require("@clusterio/controller");

describe("controller/src/UserManager", function() {
	describe("class ControllerUser", function() {
		const userManager = new UserManager({});
		it("should track online users", function() {
			let user = ControllerUser.fromJSON({ name: "admin", roles: [1] });
			userManager.users.set(user.id, user);
			assert(!userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set());

			userManager.notifyJoin(user, 12);
			assert(userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12]));

			userManager.notifyJoin(user, 8);
			assert(userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12, 8]));

			userManager.notifyLeave(user, 11);
			assert(userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([12, 8]));

			userManager.notifyLeave(user, 12);
			assert(userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set([8]));

			userManager.notifyLeave(user, 8);
			assert(!userManager.onlineUsers.has(user));
			assert.deepEqual(user.instances, new Set());
		});
		describe(".clearStatsOfInstance()", function() {
			it("should remove the instance stats from existing users", function() {
				let user1 = ControllerUser.fromJSON({ name: "admin", roles: [1] });
				let user2 = ControllerUser.fromJSON({ name: "player", roles: [1] });
				userManager.users.set(user1.id, user1);
				userManager.users.set(user2.id, user2);
				user1.instanceStats.set(10, new PlayerStats({ join_count: 1 }));
				user1.instanceStats.set(11, new PlayerStats({ join_count: 6 }));
				user1.recalculatePlayerStats();
				userManager.notifyJoin(user1, 11);
				user2.instanceStats.set(10, new PlayerStats({ join_count: 3 }));
				user2.recalculatePlayerStats();
				assert.equal(user1.playerStats.joinCount, 7);
				assert.equal(user2.playerStats.joinCount, 3);
				assert(userManager.onlineUsers.has(user1));

				userManager.clearStatsOfInstance(11);

				assert.equal(user1.playerStats.joinCount, 1);
				assert(!userManager.onlineUsers.has(user1));
				assert.equal(user2.playerStats.joinCount, 3);
			});
		});
		describe(".load()", function() {
			it("should merge users on load", async function() {
				// Create a user db file containing duplicate user ids
				const names = ["user1", "User1", "user3"];
				names.forEach(name => {
					const user = ControllerUser.fromJSON({ name: name, roles: [1] });
					userManager.users.set(user.name, user);
				});

				// Setup the player stats
				const user1Before = userManager.users.get("user1");
				user1Before.instanceStats.set(9, new PlayerStats({ join_count: 3 }));
				user1Before.instanceStats.set(10, new PlayerStats({ join_count: 5 }));
				user1Before.banReason = "ban reason here";
				user1Before.isWhitelisted = true;
				user1Before.isBanned = true;
				user1Before.isAdmin = true;
				user1Before.updatedAtMs = 100;

				const user2Before = userManager.users.get("User1");
				user2Before.instanceStats.set(10, new PlayerStats({ join_count: 7 }));
				user2Before.instanceStats.set(11, new PlayerStats({ join_count: 9 }));
				user2Before.isWhitelisted = false;
				user2Before.isBanned = false;
				user2Before.isAdmin = false;
				user1Before.updatedAtMs = 200;

				const user3Before = userManager.users.get("user3");
				user3Before.instanceStats.set(10, new PlayerStats({ join_count: 11 }));
				user3Before.instanceStats.set(11, new PlayerStats({ join_count: 13 }));
				user3Before.isWhitelisted = false;
				user3Before.isAdmin = true;

				// Save and reload the user data
				await fs.emptyDir("./temp/test/user_manager");
				await userManager.save("./temp/test/user_manager/load.json");
				names.map(name => userManager.users.delete(name));
				await userManager.load("./temp/test/user_manager/load.json");

				// Check it was loaded correctly
				const user1After = userManager.users.get("user1");
				const user2After = userManager.users.get("User1");
				const user3After = userManager.users.get("user3");
				assert.notEqual(user1After, undefined, "'user1' was not loaded");
				assert.equal(user2After, undefined, "'User1' was loaded");
				assert.notEqual(user3After, undefined, "'user3' was not loaded");

				assert.equal(user1After.isAdmin, false, "User 1 is admin");
				assert.equal(user1After.isBanned, true, "User 1 is not banned");
				assert.equal(user1After.isWhitelisted, true, "User 1 is not whitelisted");
				assert.equal(user1After.banReason, "ban reason here", "User 1 ban reason is wrong");
				assert.equal(user1After.instanceStats.get(9)?.joinCount, 3, "User 1 instance 9 stats are wrong");
				assert.equal(user1After.instanceStats.get(10)?.joinCount, 12, "User 1 instance 10 stats are wrong");
				assert.equal(user1After.instanceStats.get(11)?.joinCount, 9, "User 1 instance 11 stats are wrong");

				assert.equal(user3After.isAdmin, true, "User 3 is not admin");
				assert.equal(user3After.isWhitelisted, false, "User 3 is whitelisted");
				assert.equal(user3After.instanceStats.get(10)?.joinCount, 11, "User 3 instance 10 stats are wrong");
				assert.equal(user3After.instanceStats.get(11)?.joinCount, 13, "User 3 instance 11 stats are wrong");
			});
		});
	});
});
