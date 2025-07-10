"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

describe("rce_ops", function() {
	describe("updatePackage", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.updatePackage("foo");
		});
	});

	describe("installPackage", function() {
		it("runs", async function() {
			// In dev env no side effects occur, so best we can do is check it doesn't error
			await lib.installPackage("foo");
		});
	});

	describe("handlePluginUpdate", function() {
		it("runs", async function() {
			await lib.handlePluginUpdate("foo", [{ npmPackage: "foo" }]);
		});
		it("rejects when plugin not installed", async function() {
			await assert.rejects(
				lib.handlePluginUpdate("foo", []),
				/Plugin foo is not installed on this machine/
			);
		});
	});

	describe("handlePluginInstall", function() {
		const _fetch = global.fetch;
		before(function() {
			global.fetch = function() { return { ok: false }; };
		});
		after(function() {
			global.fetch = _fetch;
		});

		it("runs", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: true };
			};

			await lib.handlePluginInstall("foo");
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});
		it("rejects when name too long", async function() {
			const pluginName = "a".repeat(215);
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` }
			);
		});
		it("rejects when invalid symbol present", async function() {
			const pluginName = "?";
			await assert.rejects(
				lib.handlePluginInstall(pluginName),
				{ message: `Invalid plugin name: ${pluginName}` },
			);
		});
		it("rejects unregistered packages", async function() {
			let calledWith = "";
			global.fetch = function(url) {
				calledWith = url;
				return { ok: false };
			};

			await assert.rejects(lib.handlePluginInstall("foo"), /Unknown plugin: foo/);
			assert.equal(calledWith, "https://registry.npmjs.com/foo");
		});
	});
});
