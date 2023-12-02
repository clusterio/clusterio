"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");


describe("lib/users", function() {
	describe("definePermission()", function() {
		it("should validate the types of its arguments", function() {
			assert.throws(
				() => lib.definePermission({ name: 123, title: "Test", description: "A test" }),
				new Error("Expected name to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({ name: "test", title: 123, description: "A test" }),
				new Error("Expected title to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({ name: "test", title: "Test", description: 123 }),
				new Error("Expected description to be a non-empty string")
			);
			assert.throws(
				() => lib.definePermission({
					name: "test", title: "Test", description: "A test", grantByDefault: 1,
				}),
				new Error("Expected grantByDefault to be a boolean")
			);
		});

		it("should define a permission", function() {
			lib.definePermission({ name: "test", title: "Test", description: "A test" });
			assert(lib.permissions.has("test"), "Permission was not defined");

			let test = lib.permissions.get("test");
			assert.equal(test.name, "test");
			assert.equal(test.title, "Test");
			assert.equal(test.description, "A test");
			assert.equal(test.grantByDefault, false);
		});

		it("should throw on already defined permission", function() {
			assert.throws(
				() => lib.definePermission({ name: "test", title: "Test", description: "A test" }),
				new Error("Permission 'test' is already defined")
			);
		});
	});
});
