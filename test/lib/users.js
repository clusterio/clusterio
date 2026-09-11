import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";


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

	describe("registerPluginPermissions()", function() {
		it("should define the permissions declared by plugins", function() {
			lib.registerPluginPermissions([
				{ name: "foo", permissions: [
					{ name: "foo.first", title: "First", description: "The first" },
					{ name: "foo.second", title: "Second", description: "The second", grantByDefault: true },
				]},
				{ name: "bar" },
				{ name: "baz", permissions: [] },
			]);
			assert(lib.permissions.has("foo.first"), "foo.first was not defined");
			assert.equal(lib.permissions.get("foo.first").grantByDefault, false);
			assert(lib.permissions.has("foo.second"), "foo.second was not defined");
			assert.equal(lib.permissions.get("foo.second").grantByDefault, true);
		});

		it("should throw if the name does not start with the plugin name", function() {
			assert.throws(
				() => lib.registerPluginPermissions([
					{ name: "foo", permissions: [{ name: "bar.spam", title: "Spam", description: "Spam" }] },
				]),
				new Error("Expected name of permission 'bar.spam' for foo to start with 'foo.'")
			);
			assert.throws(
				() => lib.registerPluginPermissions([
					{ name: "foo", permissions: [{ title: "Spam", description: "Spam" }] },
				]),
				new Error("Expected name of permission 'undefined' for foo to start with 'foo.'")
			);
		});

		it("should throw on already defined permission", function() {
			assert.throws(
				() => lib.registerPluginPermissions([
					{ name: "foo", permissions: [{ name: "foo.first", title: "First", description: "The first" }] },
				]),
				new Error("Permission 'foo.first' is already defined")
			);
		});
	});
});
