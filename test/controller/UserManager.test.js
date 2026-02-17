"use strict";
const path = require("path");
const fs = require("fs-extra");
const assert = require("assert").strict;
const jwt = require("jsonwebtoken");
const { Role, SubscribableDatastore, ControllerConfig } = require("@clusterio/lib");
const { UserRecord, UserManager } = require("@clusterio/controller");

const TEMP_DIR = path.join("temp", "test", "UserManager");

describe("lib/controller/UserManager", function () {
	/** @type {SubscribableDatastore<UserRecord>} */
	let records;
	/** @type {SubscribableDatastore<Role>} */
	let roles;
	/** @type {ControllerConfig} */
	let config;
	/** @type {UserManager} */
	let userManager;

	beforeEach(async function () {
		records = new SubscribableDatastore();
		roles = new SubscribableDatastore();
		config = new ControllerConfig("controller", {
			"controller.default_role_id": null,
			"controller.auth_secret": Buffer.from("mysecret").toString("base64"),
		});
		userManager = new UserManager(records, roles, config);
		await fs.emptyDir(TEMP_DIR);
	});

	describe(".getById() / .getByIdMutable() / .getByName() / .getByNameMutable()", function () {
		it("should return user when exists", function () {
			const user = userManager.createUser("Alice");
			assert.deepEqual(userManager.getById(user.id), user);
			assert.deepEqual(userManager.getByIdMutable(user.id), user);
			assert.deepEqual(userManager.getByName("Alice"), user);
			assert.deepEqual(userManager.getByNameMutable("Alice"), user);
		});

		it("should return undefined when user does not exist", function () {
			assert.equal(userManager.getById("nonexistent"), undefined);
			assert.equal(userManager.getByName("nonexistent"), undefined);
		});
	});

	describe(".values() / .valuesMutable()", function () {
		it("should iterate all users", function () {
			const u1 = userManager.createUser("Alice");
			const u2 = userManager.createUser("Bob");

			const values = Array.from(userManager.values());
			const valuesMutable = Array.from(userManager.valuesMutable());

			assert.deepEqual(values, [u1, u2]);
			assert.deepEqual(valuesMutable, [u1, u2]);
		});
	});

	describe(".createUser()", function () {
		it("should create and store a new user", function () {
			const user = userManager.createUser("Charlie");
			assert.deepEqual(userManager.getByName("Charlie"), user);
			assert.deepEqual(records.getMutable(user.id).toJSON(), user.toJSON());
		});

		it("should throw if user already exists", function () {
			userManager.createUser("Dave");
			assert.throws(() => userManager.createUser("Dave"), /already exists/);
		});

		it("should assign default role if configured and exists", function () {
			roles.set(new Role(1, "admin"));
			config.set("controller.default_role_id", 1);
			const user = userManager.createUser("Eve");
			assert(user.roleIds.has(1));
		});
	});

	describe(".getOrCreateUser()", function () {
		it("should return existing user", function () {
			const existing = userManager.createUser("Frank");
			const found = userManager.getOrCreateUser("Frank");
			assert.deepEqual(found, existing);
		});

		it("should create user if missing", function () {
			const found = userManager.getOrCreateUser("Grace");
			assert(userManager.getByName("Grace"));
			assert.deepEqual(found, userManager.getByName("Grace"));
		});
	});

	describe(".deleteUser()", function () {
		it("should delete user from records", function () {
			const user = userManager.createUser("Heidi");
			assert(userManager.getByName("Heidi"));
			userManager.deleteUser(user);
			assert.equal(userManager.getByName("Heidi"), undefined);
		});
	});

	describe(".signUserToken()", function () {
		it("should return a valid JWT for user", function () {
			const user = userManager.createUser("Ivan");
			const token = userManager.signUserToken(user);
			const payload = jwt.verify(
				token,
				Buffer.from(config.get("controller.auth_secret"), "base64")
			);
			const { iat, ...rest } = payload;
			assert.equal(typeof iat, "number");
			assert.deepEqual(rest, { aud: "user", user: user.id });
		});
	});

	describe(".clearStatsOfInstance()", function () {
		it("should clear instance stats for all users", function () {
			const instanceId = 42;

			records.set(UserRecord.fromJSON({ name: "Jack", instance_stats: [[instanceId, { join_count: 1 }]] }));
			records.set(UserRecord.fromJSON({ name: "Jill", instance_stats: [[instanceId, { join_count: 1 }]] }));

			userManager.clearStatsOfInstance(instanceId);

			for (const user of userManager.values()) {
				assert(!user.instanceStats.has(instanceId), `${user.id} still has instanceStats for ${instanceId}`);
			}
		});
	});

	describe("static attemptMigrateLegacyUsersFile()", function () {
		const usersFile = path.join(TEMP_DIR, "users.json");
		const rolesFile = path.join(TEMP_DIR, "roles.json");

		it("should do nothing if file does not exist", async function () {
			await UserManager.attemptMigrateLegacyUsersFile(usersFile, rolesFile);
		});

		it("should do nothing if roles key missing", async function () {
			await fs.writeJson(usersFile, { users: [] });
			await UserManager.attemptMigrateLegacyUsersFile(usersFile, rolesFile);
			const content = await fs.readJson(usersFile);
			assert.deepEqual(content, { users: [] });
		});

		it("should throw if users key missing in legacy file", async function () {
			await fs.writeJson(usersFile, { roles: [] });
			await assert.rejects(
				() => UserManager.attemptMigrateLegacyUsersFile(usersFile, rolesFile),
				/Error: Legacy users json does not contain users property/
			);
		});

		it("should migrate valid legacy file", async function () {
			const legacy = { roles: [{ id: 1 }, { id: 2 }], users: [{ name: "Karl" }] };
			await fs.writeJson(usersFile, legacy);

			await UserManager.attemptMigrateLegacyUsersFile(usersFile, rolesFile);

			const writtenRoles = await fs.readJson(rolesFile);
			const writtenUsers = await fs.readJson(usersFile);

			assert.deepEqual(writtenRoles, [{ id: 1 }, { id: 2 }]);
			assert.deepEqual(writtenUsers, [{ name: "Karl" }]);
		});
	});
});
