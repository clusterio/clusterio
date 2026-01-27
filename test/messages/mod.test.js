"use strict";
const assert = require("assert").strict;

const lib = require("@clusterio/lib");
const { ModDependencyResolveRequest, ModDependency, ModInfo } = lib;

const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

const { Controller, ControlConnection, ControllerUser } = require("@clusterio/controller");
const { slowTest } = require("../integration");

describe("messages/mod", function() {
	/** @type {Controller} */
	let controller;
	/** @type {ControlConnection} */
	let controlConnection;
	/** @type {Map<string, lib.ModInfo>} */
	let ModReleases = new Map();

	/**
	 * @param {string} name
	 * @param {string} version
	 * @param {string} factorioVersion
	 * @param {string[]} dependencies
	 */
	function setPortalModRelease(name, version, factorioVersion, dependencies) {
		ModReleases.set(name, {
			name: name,
			releases: [{
				version: version,
				info_json: {
					factorio_version: factorioVersion,
					dependencies: ["base", ...dependencies],
				},
			}],
		});
	}

	const _ModStore_fetchModReleases = lib.ModStore.fetchModReleases;

	after(function() {
		lib.ModStore.fetchModReleases = _ModStore_fetchModReleases;
	});

	beforeEach(function() {
		ModReleases = new Map();
		lib.ModStore.fetchModReleases = function(modName) {
			const mod = ModReleases.get(modName);
			if (mod) {
				return mod;
			}
			throw new Error("Mock 404");
		};

		const controllerConfig = new lib.ControllerConfig("controller");
		const connection = new lib.VirtualConnector(
			lib.Address.fromShorthand("controller"),
			lib.Address.fromShorthand({ controlId: 1 }),
		);
		controller = new Controller(lib.logger, [], controllerConfig);
		const user = new ControllerUser(controller.userManager, undefined, "test");
		controlConnection = new ControlConnection({ version: "2.0.0" }, connection, controller, user, 1);
	});

	describe("ModDependencyResolveRequest", function() {
		describe("static", function() {
			const factorioVersions = ["1.0", "1.1", "2.0"];
			const tests = testMatrix(
				[ // mods
					[],
					[new ModDependency("foo")],
					[new ModDependency("? foo"), new ModDependency("bar > 2.0.5")],
				],
				factorioVersions, // factorioVersion
				[undefined, true, false],
			);
			it("should be round trip json serialisable", function() {
				testRoundTripJsonSerialisable(ModDependencyResolveRequest, tests);
			});
			it("should be construable", function() {
				for (const [mods, factorioVersion, checkForUpdates] of tests) {
					const request = new ModDependencyResolveRequest(mods, factorioVersion, checkForUpdates);
					assert.equal(request.factorioVersion, factorioVersion);
					assert.equal(request.checkForUpdates, checkForUpdates ?? false);
					assert.equal(request.mods, mods);
				}
			});
			it("should be constructed from a ModPack", function() {
				for (const factorioVersion of factorioVersions) {
					const mods = [
						{ name: "foo", version: "1.0.0", enabled: true },
						{ name: "bar", version: "2.0.0", enabled: false },
					];
					const modPack = lib.ModPack.fromJSON({ mods: mods, factorio_version: factorioVersion });
					const request = ModDependencyResolveRequest.fromModPack(modPack);

					assert.equal(request.factorioVersion, factorioVersion, factorioVersion);
					assert.equal(request.mods.length, modPack.mods.size, factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "foo"), new ModDependency("foo = 1.0.0"), factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "bar"), new ModDependency("bar = 2.0.0"), factorioVersion);
				}
			});
			it("should be constructed from a ModPack (enabled only)", function() {
				for (const factorioVersion of factorioVersions) {
					const mods = [
						{ name: "foo", version: "1.0.0", enabled: true },
						{ name: "bar", version: "2.0.0", enabled: false },
					];
					const modPack = lib.ModPack.fromJSON({ mods: mods, factorio_version: factorioVersion });
					const request = ModDependencyResolveRequest.fromModPackEnabled(modPack);

					assert.equal(request.factorioVersion, factorioVersion);
					assert.equal(
						request.mods.length, [...modPack.mods.values()].filter(m => m.enabled).length, factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "foo"), new ModDependency("foo = 1.0.0"), factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "bar"), undefined, factorioVersion);
				}
			});
			it("should be constructed from a ModPack (check for updates)", function() {
				for (const factorioVersion of factorioVersions) {
					const mods = [
						{ name: "foo", version: "1.0.0", enabled: true },
						{ name: "bar", version: "2.0.0", enabled: false },
					];
					const modPack = lib.ModPack.fromJSON({ mods: mods, factorio_version: factorioVersion });
					const request = ModDependencyResolveRequest.fromModPack(modPack, true);

					assert.equal(request.factorioVersion, factorioVersion, factorioVersion);
					assert.equal(request.mods.length, modPack.mods.size, factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "foo"), new ModDependency("foo >= 1.0.0"), factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "bar"), new ModDependency("bar >= 2.0.0"), factorioVersion);
				}
			});
			it("should be constructed from a ModPack (enabled only) (check for updates)", function() {
				for (const factorioVersion of factorioVersions) {
					const mods = [
						{ name: "foo", version: "1.0.0", enabled: true },
						{ name: "bar", version: "2.0.0", enabled: false },
					];
					const modPack = lib.ModPack.fromJSON({ mods: mods, factorio_version: factorioVersion });
					const request = ModDependencyResolveRequest.fromModPackEnabled(modPack, true);

					assert.equal(request.factorioVersion, factorioVersion);
					assert.equal(
						request.mods.length, [...modPack.mods.values()].filter(m => m.enabled).length, factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "foo"), new ModDependency("foo >= 1.0.0"), factorioVersion);
					assert.deepEqual(
						request.mods.find(m => m.name === "bar"), undefined, factorioVersion);
				}
			});
		});
		describe("response", function() {
			const tests = testMatrix(
				[ // dependencies
					[],
					[
						ModInfo.fromJSON({ name: "foo", version: "1.0.0" }),
					],
					[
						ModInfo.fromJSON({ name: "foo", version: "1.0.0" }),
						ModInfo.fromJSON({ name: "bar", version: "2.0.0" }),
					],
				],
				[[], ["foo-i"], ["foo-i", "bar-i"]], // incompatible
				[[], ["foo-m"], ["foo-m", "bar-m"]], // missing
			);
			it("should be round trip json serialisable", function() {
				testRoundTripJsonSerialisable(ModDependencyResolveRequest.Response, tests);
			});
			it("should be construable", function() {
				for (const [dependencies, incompatible, missing] of tests) {
					const test = JSON.stringify([dependencies, missing, incompatible]);
					const request = new ModDependencyResolveRequest.Response(dependencies, incompatible, missing);
					assert.deepEqual(request.dependencies, dependencies, test);
					assert.deepEqual(request.incompatible, incompatible, test);
					assert.deepEqual(request.missing, missing, test);
				}
			});
		});
		describe("handle", function() {
			const factorioVersions = ["1.0", "1.1", "2.0"];
			it("resolves dependencies", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo", "bar < 2.0.0", "? baz"]);
					setPortalModRelease("foo", "1.0.0", factorioVersion, ["foo-dep"]);
					setPortalModRelease("foo-dep", "1.0.0", factorioVersion, []);
					setPortalModRelease("bar", "1.0.0", factorioVersion, []);
					setPortalModRelease("baz", "1.0.0", factorioVersion, []);

					setPortalModRelease("root-2", "1.0.0", factorioVersion, ["foo", "bar-2"]);
					setPortalModRelease("bar-2", "1.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest(
							[new ModDependency("root"), new ModDependency("root-2")],
							factorioVersion,
						)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, []);

					const expectedIds = [
						"root_1.0.0", "foo_1.0.0", "foo-dep_1.0.0", "bar_1.0.0",
						"root-2_1.0.0", "bar-2_1.0.0",
					];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("highlights dependencies with no suitable version", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["bar < 2.0.0"]);
					setPortalModRelease("bar", "2.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base", "bar"]);
					assert.deepEqual(result.incompatible, []);

					assert.equal(result.dependencies.length, 1);
					assert.equal(result.dependencies[0].id, "root_1.0.0");
				}
			});
			it("highlights dependencies with no releases", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo"]);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base", "foo"]);
					assert.deepEqual(result.incompatible, []);

					assert.equal(result.dependencies.length, 1);
					assert.equal(result.dependencies[0].id, "root_1.0.0");
				}
			});
			it("highlights dependencies which are incompatible", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo", "! foo-dep"]);
					setPortalModRelease("foo", "1.0.0", factorioVersion, ["foo-dep"]);
					setPortalModRelease("foo-dep", "1.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, ["foo-dep"]);

					const expectedIds = ["root_1.0.0", "foo_1.0.0", "foo-dep_1.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("highlights dependencies with conflicting versions", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo", "bar"]);
					setPortalModRelease("foo", "1.0.0", factorioVersion, ["dep > 2.0.0"]);
					setPortalModRelease("bar", "1.0.0", factorioVersion, ["dep < 1.5.0"]);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, ["dep"]);

					const expectedIds = ["root_1.0.0", "foo_1.0.0", "bar_1.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("highlights incompatible builtin mods", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo"]);
					setPortalModRelease("foo", "1.0.0", factorioVersion, ["! base"]);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, []);
					assert.deepEqual(result.incompatible, ["base"]);

					const expectedIds = ["root_1.0.0", "foo_1.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("does not ignore optional dependencies when required by another", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo", "? baz"]);
					setPortalModRelease("foo", "1.0.0", factorioVersion, ["baz"]);
					setPortalModRelease("baz", "1.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, []);

					const expectedIds = ["root_1.0.0", "foo_1.0.0", "baz_1.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("prefers the locally installed version if matching", async function() {
				controller.modStore.addMod(lib.ModInfo.fromJSON({ name: "foo", version: "1.0.0" }));
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo"]);
					setPortalModRelease("foo", "2.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, []);

					const expectedIds = ["root_1.0.0", "foo_1.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("prefers the mod portal version when checking for updates", async function() {
				controller.modStore.addMod(lib.ModInfo.fromJSON({ name: "foo", version: "1.0.0" }));
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo"]);
					setPortalModRelease("foo", "2.0.0", factorioVersion, []);

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion, true)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, []);

					const expectedIds = ["root_1.0.0", "foo_2.0.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("prefers the latest mod portal version when using the mod portal", async function() {
				for (const factorioVersion of factorioVersions) {
					setPortalModRelease("root", "1.0.0", factorioVersion, ["foo", "bar < 2.0.0"]);

					ModReleases.set("foo", {
						name: "foo",
						releases: [{
							version: "1.0.0", info_json: { factorio_version: factorioVersion, dependencies: [] },
						}, {
							version: "2.0.0", info_json: { factorio_version: factorioVersion, dependencies: [] },
						}],
					});

					ModReleases.set("bar", {
						name: "bar",
						releases: [{
							version: "1.0.0", info_json: { factorio_version: factorioVersion, dependencies: [] },
						}, {
							version: "1.5.0", info_json: { factorio_version: factorioVersion, dependencies: [] },
						}, {
							version: "2.0.0", info_json: { factorio_version: factorioVersion, dependencies: [] },
						}],
					});

					const result = await controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					);

					assert.deepEqual(result.missing, ["base"]);
					assert.deepEqual(result.incompatible, []);

					const expectedIds = ["root_1.0.0", "foo_2.0.0", "bar_1.5.0"];

					const depIds = new Set(result.dependencies.map(mod => mod.id));
					assert.equal(depIds.size, expectedIds.length);
					for (const modId of expectedIds) {
						assert(depIds.has(modId), `Missing ${modId}`);
					}
				}
			});
			it("rejects when a network error occurs", async function() {
				lib.ModStore.fetchModReleases = function() {
					throw new Error("Mock network error");
				};

				for (const factorioVersion of factorioVersions) {
					await assert.rejects(controlConnection.handleModDependencyResolveRequest(
						new lib.ModDependencyResolveRequest([new ModDependency("root")], factorioVersion)
					));
				}
			});
			it("resolves dependencies (live)", async function() {
				this.timeout(60000); // Increase timeout to 60 seconds for live API call
				lib.ModStore.fetchModReleases = _ModStore_fetchModReleases;

				const result = await controlConnection.handleModDependencyResolveRequest(
					new lib.ModDependencyResolveRequest([new ModDependency("pymodpack = 3.0.0")], "2.0")
				);

				assert.deepEqual(result.missing, ["base"]);
				assert.deepEqual(result.incompatible, ["space-age"]);

				const expectedNames = [ // Can't use ids as the versions may change
					"pymodpack", "pypostprocessing", "pyalternativeenergy", "pyalternativeenergygraphics",
					"pyalienlife", "pyalienlifegraphics", "pyalienlifegraphics2", "pyalienlifegraphics3",
					"pycoalprocessing", "pycoalprocessinggraphics", "pyfusionenergy", "pyfusionenergygraphics",
					"pypetroleumhandling", "pypetroleumhandlinggraphics", "pyrawores", "pyraworesgraphics",
					"pyhightech", "pyhightechgraphics", "pyindustry", "pyindustrygraphics",
				];

				const depNames = new Set(result.dependencies.map(mod => mod.name));
				assert.equal(depNames.size, expectedNames.length);
				for (const modName of expectedNames) {
					assert(depNames.has(modName), `Missing ${modName}`);
				}
			});
		});
	});
});
