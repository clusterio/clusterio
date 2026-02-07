"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

describe("lib/data/Role", function() {
	let defaultPermissions;
	before(function() {
		// We need to do this here because plugins may add new default permissions
		defaultPermissions = new Set([...lib.permissions.values()]
			.filter(permission => permission.grantByDefault)
			.map(permission => permission.name));
	});

	describe("class Role", function() {

		describe("JSON serialization", function() {
			it("should round trip serialize with default optional values", function() {
				const role = new lib.Role(11, "Role", "My Role");
				assert.equal(role.updatedAtMs, 0);
				assert.equal(role.isDeleted, false);

				const json = role.toJSON();
				assert.equal(json.updated_at_ms, 0);
				assert.equal(json.is_deleted, false);

				const copy = lib.Role.fromJSON(json);
				assert.deepEqual(copy, role);
			});
			it("should preserve optional fields once set", function() {
				const role = new lib.Role(11, "Test", "My Role", new Set(["test"]), 1234, true);

				const json = role.toJSON();
				assert.deepEqual(json.permissions, ["test"]);
				assert.equal(json.updated_at_ms, 1234);
				assert.equal(json.is_deleted, true);

				const copy = lib.Role.fromJSON(json);
				assert.deepEqual(copy, role);
			});
		});

		describe("grantDefaultPermissions()", function() {
			it("should only grant permissions marked grantByDefault", function() {
				const role = new lib.Role(20, "Defaults", "Defaults");
				role.grantDefaultPermissions();

				assert.deepEqual(
					role.permissions, defaultPermissions,
					"Granted default permissions does not match"
				);

				for (const permName of role.permissions) {
					const perm = lib.permissions.get(permName);
					assert(perm, `Permission ${permName} does not exist`);
					assert.equal(
						perm.grantByDefault, true,
						`Permission ${permName} was not grantByDefault`
					);
				}
			});
		});

		describe("grantAdminPermissions()", function() {
			it("should grant core.admin permission", function() {
				const role = new lib.Role(1, "Admin", "Admin role");
				role.grantAdminPermissions();
				assert(role.permissions.has("core.admin"));
			});
		});

		describe("ensureDefaultPlayerRole()", function() {
			it("should create player role if missing", function() {
				let storedRole;

				const roles = {
					get(id) {
						assert.equal(id, lib.Role.DefaultPlayerRoleId);
						return undefined;
					},
					set(role) {
						storedRole = role;
					},
				};

				lib.Role.ensureDefaultPlayerRole(roles);

				assert(storedRole, "Expected role to be created");
				assert.equal(storedRole.id, lib.Role.DefaultPlayerRoleId);
				assert.equal(storedRole.name, "Player");
				assert.deepEqual(
					storedRole.permissions, defaultPermissions,
					"Granted default permissions does not match"
				);
			});

			it("should reuse existing player role", function() {
				const storedRole = new lib.Role(
					lib.Role.DefaultPlayerRoleId,
					"Existing Player",
					"Existing"
				);

				const roles = {
					get() {
						return storedRole;
					},
					set(role) {
						assert.equal(role, storedRole);
					},
				};

				lib.Role.ensureDefaultPlayerRole(roles);
				assert.deepEqual(
					storedRole.permissions, defaultPermissions,
					"Granted default permissions does not match"
				);
			});
		});

		describe("ensureDefaultAdminRole()", function() {
			it("should create admin role if missing", function() {
				let storedRole;

				const roles = {
					get(id) {
						assert.equal(id, lib.Role.DefaultAdminRoleId);
						return undefined;
					},
					set(role) {
						storedRole = role;
					},
				};

				lib.Role.ensureDefaultAdminRole(roles);

				assert(storedRole, "Expected admin role to be created");
				assert.equal(storedRole.id, lib.Role.DefaultAdminRoleId);
				assert.equal(storedRole.name, "Cluster Admin");
				assert(storedRole.permissions.has("core.admin"));
			});

			it("should reuse existing admin role", function() {
				const existing = new lib.Role(
					lib.Role.DefaultAdminRoleId,
					"Existing Admin",
					"Existing"
				);

				const roles = {
					get() {
						return existing;
					},
					set(role) {
						assert.equal(role, existing);
					},
				};

				lib.Role.ensureDefaultAdminRole(roles);
				assert(existing.permissions.has("core.admin"));
			});
		});
	});
});
