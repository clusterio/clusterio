"use strict";
const assert = require("assert").strict;
const { Role, SubscribableDatastore } = require("@clusterio/lib");
const { User } = require("@clusterio/controller");

describe("controller/User", function () {
	/** @type {SubscribableDatastore<UserRecord>} */
	let users;
	/** @type {SubscribableDatastore<Role>} */
	let roles;
	/** @type {User} */
	let user;

	beforeEach(function () {
		users = new SubscribableDatastore();
		roles = new SubscribableDatastore();

		// Create a role and user used in most tests
		roles.set(Role.fromJSON({ id: 1, name: "connectRole", permissions: ["core.control.connect"] }));
		user = User.fromJSON({ name: "Alice", roles: [1] }, users, roles);

		users.set(user);
		user.updatedAtMs = 1000; // Known low value
	});

	describe("get roles", function () {
		it("should return roles from _controllerRoles", function () {
			const roleSet = user.roles;
			assert.strictEqual(roleSet.size, 1);
			assert.strictEqual([...roleSet][0].id, 1);
		});
	});

	describe(".saveRecord() / set", function () {
		it("should update updatedAtMs", function () {
			const prev = user.updatedAtMs;
			user.saveRecord();
			assert(user.updatedAtMs > prev);
		});
	});

	describe(".set()", function () {
		it("should update updatedAtMs", function () {
			const prev = user.updatedAtMs;
			user.set("isAdmin", true);
			assert.strictEqual(user.isAdmin, true);
			assert(user.updatedAtMs > prev);
		});
	});

	describe(".invalidateToken()", function () {
		it("should update tokenValidAfter to current time", function () {
			const prevValid = user.tokenValidAfter;
			const prevUpdate = user.updatedAtMs;
			user.invalidateToken();
			assert(user.tokenValidAfter > prevValid);
			assert(user.updatedAtMs > prevUpdate);
		});
	});

	describe(".addRole()", function () {
		it("should add role if exists", function () {
			roles.set(Role.fromJSON({ id: 2, name: "admin", permissions: ["core.admin"] }));
			const prev = user.updatedAtMs;

			user.addRole(2);
			assert(user.roleIds.has(2));
			assert(user.updatedAtMs > prev);
		});

		it("should throw if role does not exist", function () {
			assert.throws(() => user.addRole(999), /role 999 does not exist/);
		});
	});

	describe(".removeRole()", function () {
		it("should remove existing role", function () {
			const prev = user.updatedAtMs;
			const result = user.removeRole(1);
			assert(result);
			assert(!user.roleIds.has(1));
			assert(user.updatedAtMs > prev);
		});

		it("should return false if role was not assigned", function () {
			const prev = user.updatedAtMs;
			const result = user.removeRole(999);
			assert.strictEqual(result, false);
			assert(user.updatedAtMs === prev); // unchanged
		});
	});

	describe(".notifyJoin() / .notifyLeave()", function () {
		it("should add instance on notifyJoin", function () {
			const prev = user.updatedAtMs;
			user.notifyJoin(10);
			assert(user.instances.has(10));
			assert(user.updatedAtMs > prev);
		});

		it("should remove instance on notifyLeave", function () {
			user.notifyJoin(10);
			user.updatedAtMs = 1000; // Known low value
			user.notifyLeave(10);
			assert(!user.instances.has(10));
			assert(user.updatedAtMs > 1000);
		});
	});

	describe(".clearInstanceStats()", function () {
		it("should remove instanceStats and recalculate playerStats", function () {
			const instanceId = 5;
			const userWithStats = User.fromJSON({
				name: "Bob",
				instanceStats: [[instanceId, { join_count: 1 }]],
			}, users, roles);

			users.set(userWithStats);
			userWithStats.updatedAtMs = 1000; // Known low value

			userWithStats.clearInstanceStats(instanceId);
			assert(!userWithStats.instanceStats.has(instanceId));
			assert(userWithStats.updatedAtMs > 1000);
		});
	});

	describe(".checkPermission()", function () {
		it("should allow if role has core.control.connect", function () {
			assert.doesNotThrow(() => user.checkPermission("core.control.connect"));
		});

		it("should allow if role has core.admin", function () {
			roles.set(Role.fromJSON({ id: 2, name: "admin", permissions: ["core.admin"] }));
			const adminUser = User.fromJSON({ name: "Charlie", roles: [2] }, users, roles);
			assert.doesNotThrow(() => adminUser.checkPermission("core.admin"));
		});

		it("should throw if permission not granted", function () {
			assert.throws(() => user.checkPermission("core.admin"), /Permission denied/);
		});

		it("should throw if permission does not exist", function () {
			assert.throws(() => user.checkPermission("nonexistent.permission"), /does not exist/);
		});
	});
});
