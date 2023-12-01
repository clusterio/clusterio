"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");


describe("lib/data/Role", function() {
	describe("class Role", function() {
		it("should round trip serialize", function() {
			let orig = lib.Role.fromJSON({ id: 11, name: "Role", description: "My Role", permissions: ["test"] });
			let copy = lib.Role.fromJSON(orig.toJSON());
			assert.deepEqual(copy, orig);
		});

		describe(".grantDefaultRoles()", function() {
			it("should only grant permissions with grantByDefault", function() {
				let role = lib.Role.fromJSON({ id: 11, name: "Role", description: "My Role" });
				role.grantDefaultPermissions();
				assert(role.permissions.size > 0, "No permissions were granted");
				for (let permission of role.permissions) {
					assert(
						lib.permissions.get(permission).grantByDefault === true,
						"Non-default permission granted"
					);
				}
			});
		});
	});
});
