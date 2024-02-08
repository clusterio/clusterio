"use strict";
const assert = require("assert").strict;
const { PlayerStats } = require("@clusterio/lib");
const { ControllerUser, UserManager } = require("@clusterio/controller");

describe("controller/src/UserManager", function() {
	describe("class ControllerUser", function() {
		const userManager = new UserManager({});
		it("should track online users", function() {
			let user = ControllerUser.fromJSON({ name: "admin", roles: [1] });
			userManager.users.set(user.name, user);
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
				userManager.users.set(user1.name, user1);
				userManager.users.set(user2.name, user2);
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
	});
});
