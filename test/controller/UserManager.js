"use strict";
const assert = require("assert").strict;
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
	});
});
