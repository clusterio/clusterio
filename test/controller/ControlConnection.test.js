"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { ControlConnection } = require("@clusterio/controller");

describe("controller/src/ControlConnection", function() {
	describe(".handleControllerRestartRequest()", function() {
		let mockController;

		beforeEach(function() {
			mockController = {
				canRestart: true,
				shouldRestart: false,
				stopped: false,
				async checkRestartDowngrade() { return null; },
				stop() { this.stopped = true; },
			};
		});

		async function restart() {
			await ControlConnection.prototype.handleControllerRestartRequest.call({
				_controller: mockController,
			});
		}

		it("restarts when the installed version is not older", async function() {
			await restart();
			assert.equal(mockController.shouldRestart, true);
			assert.equal(mockController.stopped, true);
		});

		it("rejects a downgrade without stopping the controller", async function() {
			mockController.checkRestartDowngrade = async () => ({
				installedVersion: "1.0.0",
				runningVersion: "2.0.0",
			});

			await assert.rejects(restart, /Stop the controller before starting the older version manually/);
			assert.equal(mockController.shouldRestart, false);
			assert.equal(mockController.stopped, false);
		});
	});

	describe(".handleModDependencyResolveRequest()", function() {
		const originalFetchModReleases = lib.ModStore.fetchModReleases;
		const portal = new Map();
		let localMods;

		function release(version, factorioVersion, dependencies = []) {
			return {
				version, sha1: "0".repeat(40),
				info_json: { factorio_version: factorioVersion, dependencies },
			};
		}

		before(function() {
			lib.ModStore.fetchModReleases = async (name) => {
				const releases = portal.get(name);
				if (!releases) {
					throw new Error("Fetch: returned 404 Not Found");
				}
				return { name, owner: "owner", title: name, releases };
			};
		});
		after(function() {
			lib.ModStore.fetchModReleases = originalFetchModReleases;
		});
		beforeEach(function() {
			portal.clear();
			localMods = [];
		});

		async function resolve(mods, factorioVersion, checkForUpdates = false) {
			const response = await ControlConnection.prototype.handleModDependencyResolveRequest.call(
				{ _controller: { modStore: { mods: () => localMods } } },
				new lib.ModDependencyResolveRequest(
					mods.map(mod => new lib.ModDependency(mod)), factorioVersion, checkForUpdates,
				),
			);
			return new Map(response.dependencies.map(mod => [mod.name, mod]));
		}

		it("only selects portal releases matching the mod pack's Factorio version", async function() {
			portal.set("root", [release("1.0.0", "2.0", ["dep"]), release("1.1.0", "2.1", ["dep"])]);
			portal.set("dep", [
				release("1.0.0", "1.1"),
				release("2.0.0", "2.0"),
				release("3.0.0", "2.1"),
			]);
			assert.equal((await resolve(["root = 1.0.0"], "2.0")).get("dep").version, "2.0.0");
			assert.equal((await resolve(["root = 1.1.0"], "2.1")).get("dep").version, "3.0.0");
		});

		it("only selects local mods matching the mod pack's Factorio version", async function() {
			portal.set("root", [release("1.0.0", "2.0", ["dep"])]);
			portal.set("dep", [release("2.0.0", "2.0")]);
			localMods = [
				lib.ModInfo.fromJSON({ name: "dep", version: "3.0.0", factorio_version: "2.1" }),
				lib.ModInfo.fromJSON({ name: "dep", version: "1.0.0", factorio_version: "2.0" }),
			];
			assert.equal((await resolve(["root = 1.0.0"], "2.0")).get("dep").version, "1.0.0");
			assert.equal((await resolve(["root = 1.0.0"], "2.0", true)).get("dep").version, "2.0.0");
		});

		it("reports dependencies without a matching Factorio version as not found", async function() {
			portal.set("root", [release("1.0.0", "2.0", ["dep"])]);
			portal.set("dep", [release("3.0.0", "2.1")]);
			const response = await ControlConnection.prototype.handleModDependencyResolveRequest.call(
				{ _controller: { modStore: { mods: () => localMods } } },
				new lib.ModDependencyResolveRequest([new lib.ModDependency("root = 1.0.0")], "2.0", false),
			);
			assert.equal(response.errors.get("dep"), "notFound");
		});
	});
});
