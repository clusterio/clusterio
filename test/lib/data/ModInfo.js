"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const lib = require("@clusterio/lib");
const libBuildMod = require("@clusterio/lib/build_mod");
const { ModInfo, ModDependency } = lib;


describe("lib/data/ModInfo", function() {
	describe("class ModDependency", function() {
		describe(".getTypeFromPrefix()", function() {
			it("should not throw for valid prefixes", function() {
				assert.equal(ModDependency.getTypeFromPrefix("!"), "incompatible");
				assert.equal(ModDependency.getTypeFromPrefix("?"), "optional");
				assert.equal(ModDependency.getTypeFromPrefix("(?)"), "hidden");
				assert.equal(ModDependency.getTypeFromPrefix("~"), "unordered");
				assert.equal(ModDependency.getTypeFromPrefix(""), "required");
			});
			it("should throw for unknown prefixes", function() {
				assert.throws(() => ModDependency.getTypeFromPrefix("invalid"));
			});
		});
		describe("constructor", function() {
			it("should accept specifications of name only", function() {
				const dependency = new ModDependency("my-mod");
				assert.equal(dependency.name, "my-mod");
				assert.equal(dependency.type, "required");
				assert.equal(dependency.version, undefined);
			});
			it("should accept specifications of name and prefix", function() {
				const dependency = new ModDependency("? my-mod");
				assert.equal(dependency.name, "my-mod");
				assert.equal(dependency.type, "optional");
				assert.equal(dependency.version, undefined);
			});
			it("should accept specifications of name and version", function() {
				const dependency = new ModDependency("my-mod >= 1.2.3");
				assert.equal(dependency.name, "my-mod");
				assert.equal(dependency.type, "required");
				assert.notEqual(dependency.version, undefined);
				assert.equal(dependency.version.equality, ">=");
				assert.equal(dependency.version.integerVersion, lib.integerFullVersion("1.2.3"));
			});
			it("should accept specifications of name, prefix and version", function() {
				const dependency = new ModDependency("? my-mod >= 1.2.3");
				assert.equal(dependency.name, "my-mod");
				assert.equal(dependency.type, "optional");
				assert.notEqual(dependency.version, undefined);
				assert.equal(dependency.version.equality, ">=");
				assert.equal(dependency.version.integerVersion, lib.integerFullVersion("1.2.3"));
			});
			it("should throw if no version equality is given", function() {
				assert.throws(() => new ModDependency("my-mod 1.2.3"));
				assert.throws(() => new ModDependency("? my-mod 1.2.3"));
			});
			it("should throw if name contains spaces", function() {
				assert.throws(() => new ModDependency("my mod"));
				assert.throws(() => new ModDependency("? my mod"));
				assert.throws(() => new ModDependency("? my mod >= 1.2.3"));
			});
		});
		describe("checkUnsatisfiedReason()", function() {
			const mods = [
				ModInfo.fromJSON({ name: "my-mod", version: "1.0.0" }),
			];
			it("should be undefined for incompatible being missing", function() {
				const dependency = new ModDependency("! not-present");
				assert.equal(dependency.checkUnsatisfiedReason(mods), undefined);
			});
			it("should give reason for incompatible being present", function() {
				const dependency = new ModDependency("! my-mod");
				assert.equal(dependency.checkUnsatisfiedReason(mods), "incompatible");
			});
			it("should undefined for optional / hidden being missing", function() {
				const dependencyOptional = new ModDependency("? not-present");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), undefined);
				const dependencyHidden = new ModDependency("(?) not-present");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), undefined);
			});
			it("should undefined for optional / hidden being present", function() {
				const dependencyOptional = new ModDependency("? my-mod");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), undefined);
				const dependencyHidden = new ModDependency("(?) my-mod");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), undefined);
			});
			it("should give reason for optional / hidden being present but wrong version", function() {
				const dependencyOptional = new ModDependency("? my-mod > 2.0.0");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), "wrong_version");
				const dependencyHidden = new ModDependency("(?) my-mod > 2.0.0");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), "wrong_version");
			});
			it("should undefined for unordered / required being present", function() {
				const dependencyOptional = new ModDependency("~ my-mod");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), undefined);
				const dependencyHidden = new ModDependency("my-mod");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), undefined);
			});
			it("should give reason for unordered / required being present but wrong version", function() {
				const dependencyOptional = new ModDependency("~ my-mod > 2.0.0");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), "wrong_version");
				const dependencyHidden = new ModDependency("my-mod > 2.0.0");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), "wrong_version");
			});
			it("should give reason for unordered / required being missing", function() {
				const dependencyOptional = new ModDependency("~ not-present");
				assert.equal(dependencyOptional.checkUnsatisfiedReason(mods), "missing_dependency");
				const dependencyHidden = new ModDependency("not-present");
				assert.equal(dependencyHidden.checkUnsatisfiedReason(mods), "missing_dependency");
			});
		});
		describe("isSatisfied()", function() {
			const mods = [
				ModInfo.fromJSON({ name: "my-mod", version: "1.0.0" }),
			];
			it("should pass for incompatible being missing", function() {
				const dependency = new ModDependency("! not-present");
				assert.equal(dependency.isSatisfied(mods), true);
			});
			it("should fail for incompatible being present", function() {
				const dependency = new ModDependency("! my-mod");
				assert.equal(dependency.isSatisfied(mods), false);
			});
			it("should pass for optional / hidden being missing", function() {
				const dependencyOptional = new ModDependency("? not-present");
				assert.equal(dependencyOptional.isSatisfied(mods), true);
				const dependencyHidden = new ModDependency("(?) not-present");
				assert.equal(dependencyHidden.isSatisfied(mods), true);
			});
			it("should pass for optional / hidden being present", function() {
				const dependencyOptional = new ModDependency("? my-mod");
				assert.equal(dependencyOptional.isSatisfied(mods), true);
				const dependencyHidden = new ModDependency("(?) my-mod");
				assert.equal(dependencyHidden.isSatisfied(mods), true);
			});
			it("should fail for optional / hidden being present but wrong version", function() {
				const dependencyOptional = new ModDependency("? my-mod > 2.0.0");
				assert.equal(dependencyOptional.isSatisfied(mods), false);
				const dependencyHidden = new ModDependency("(?) my-mod > 2.0.0");
				assert.equal(dependencyHidden.isSatisfied(mods), false);
			});
			it("should pass for unordered / required being present", function() {
				const dependencyOptional = new ModDependency("~ my-mod");
				assert.equal(dependencyOptional.isSatisfied(mods), true);
				const dependencyHidden = new ModDependency("my-mod");
				assert.equal(dependencyHidden.isSatisfied(mods), true);
			});
			it("should fail for unordered / required being present but wrong version", function() {
				const dependencyOptional = new ModDependency("~ my-mod > 2.0.0");
				assert.equal(dependencyOptional.isSatisfied(mods), false);
				const dependencyHidden = new ModDependency("my-mod > 2.0.0");
				assert.equal(dependencyHidden.isSatisfied(mods), false);
			});
			it("should fail for unordered / required being missing", function() {
				const dependencyOptional = new ModDependency("~ not-present");
				assert.equal(dependencyOptional.isSatisfied(mods), false);
				const dependencyHidden = new ModDependency("not-present");
				assert.equal(dependencyHidden.isSatisfied(mods), false);
			});
		});
	});
	describe("class ModInfo", function() {
		it("should round trip serialize", function() {
			const validate = lib.compile(ModInfo.jsonSchema);
			function check(pack) {
				const json = JSON.parse(JSON.stringify(pack));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(ModInfo.fromJSON(json), pack);
			}

			check(ModInfo.fromJSON({}));
			check(ModInfo.fromJSON({ name: "MyMod" }));
			check(ModInfo.fromJSON({ version: "1.0.0" }));
			check(ModInfo.fromJSON({ title: "My Extravagent Mod" }));
			check(ModInfo.fromJSON({ author: "Me" }));
			check(ModInfo.fromJSON({ contact: "Use my email" }));
			check(ModInfo.fromJSON({ homepage: "It's over there" }));
			check(ModInfo.fromJSON({ description: "My Description" }));
			check(ModInfo.fromJSON({ factorio_version: "2.0" }));
			check(ModInfo.fromJSON({ dependencies: [] }));
			check(ModInfo.fromJSON({ dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"] }));
			check(ModInfo.fromJSON({ filename: "MyMod_1.0.0.zip" }));
			check(ModInfo.fromJSON({ size: 1024 }));
			check(ModInfo.fromJSON({ mtime_ms: new Date(2024, 0, 1).getTime() }));
			check(ModInfo.fromJSON({ sha1: "verified-as-MyMod" }));
			check(ModInfo.fromJSON({ is_deleted: true }));

			// All at once
			check(ModInfo.fromJSON({
				name: "MyMod",
				version: "1.0.0",
				title: "My Extravagent Mod",
				author: "Me",
				contact: "Use my email",
				homepage: "It's over there",
				description: "My Description",
				factorio_version: "2.0",
				dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"],
				filename: "MyMod_1.0.0.zip",
				size: 1024,
				mtime_ms: new Date(2024, 0, 1).getTime(),
				sha1: "verified-as-MyMod",
				is_deleted: true,
			}));
		});

		it("should sort integer mod versions lexicographically", function() {
			let unsortedVersions = ["1.0.0", "1.1.0", "0.1.0", "3.0.0", "1.2.0", "0.3.1", "0.3.3", "2.1.1", "0.0.1"];
			let sortedVersions = ["0.0.1", "0.1.0", "0.3.1", "0.3.3", "1.0.0", "1.1.0", "1.2.0", "2.1.1", "3.0.0"];
			let mods = unsortedVersions.map(v => ModInfo.fromJSON({ version: v }));
			mods.sort((a, b) => a.integerVersion - b.integerVersion);
			assert.deepEqual(mods.map(mod => mod.version), sortedVersions);
		});
		it("should sort integer factorio versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1", "0.1", "3.0", "1.2", "0.3", "2.1"];
			let sortedVersions = ["0.1", "0.3", "1.0", "1.1", "1.2", "2.1", "3.0"];
			let factorioMods = unsortedVersions.map(v => ModInfo.fromJSON({ factorio_version: v }));
			factorioMods.sort((a, b) => a.integerFactorioVersion - b.integerFactorioVersion);
			assert.deepEqual(factorioMods.map(mod => mod.factorioVersion), sortedVersions);
		});
		it("should provide the original string specifications for dependencies", function() {
			const mod = ModInfo.fromJSON({ dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"] });
			assert.deepEqual(mod.dependencySpecifications, ["UltraMod", "SuperLib >= 1.00", "! bad-mod"]);
		});
		it("should parse the provided dependency specifications", function() {
			const mod = ModInfo.fromJSON({ dependencies: ["UltraMod", "SuperLib >= 1.00", "! bad-mod"] });
			assert.deepEqual(mod.dependencies,
				["UltraMod", "SuperLib >= 1.00", "! bad-mod"].map(dep => new ModDependency(dep))
			);
		});
		it("should load from a mod zip file", async function() {
			await libBuildMod.build({
				build: true,
				pack: true,
				sourceDir: path.join("test", "file", "empty_mod"),
				outputDir: path.join("temp", "test"),
			});
			const filePath = path.join("temp", "test", "empty_mod_1.0.0.zip");
			const hash = await lib.hashFile(filePath);
			const stat = await fs.stat(filePath);
			const mod = await ModInfo.fromModFile(filePath);
			assert.deepEqual(
				mod,
				ModInfo.fromJSON({
					name: "empty_mod",
					version: "1.0.0",
					title: "An Empty Mod",
					author: "Me",
					description: "An empty mod for testing",
					factorio_version: "1.1",
					dependencies: [],
					filename: "empty_mod_1.0.0.zip",
					size: stat.size,
					mtime_ms: stat.mtimeMs,
					updated_at_ms: stat.mtimeMs,
					sha1: hash,
				})
			);
		});
		describe("checkDependencySatisfaction()", function() {
			it("should return undefined when satisfied", function() {
				const mod = ModInfo.fromJSON({ dependencies: ["! a", "b = 1.0.0", "? c = 2.0.0"] });
				assert.equal(mod.checkDependencySatisfaction([{ name: "b", version: "1.0.0" }]), undefined);
			});
			it("should return incompatible when there is an incompatibility", function() {
				const mod = ModInfo.fromJSON({ dependencies: ["! a", "b = 1.0.0", "? c = 2.0.0"] });
				assert.equal(mod.checkDependencySatisfaction([{ name: "a", version: "1.0.0" }]), "incompatible");
			});
			it("should return missing dependency when missing but no incompatibly", function() {
				const mod = ModInfo.fromJSON({ dependencies: ["! a", "b = 1.0.0", "? c = 2.0.0"] });
				assert.equal(mod.checkDependencySatisfaction([{ name: "c", version: "1.0.0" }]), "missing_dependency");
			});
			it("should return wrong version when wrong but not missing or incompatible", function() {
				const mod = ModInfo.fromJSON({ dependencies: ["! a", "b = 1.0.0", "? c = 2.0.0"] });
				assert.equal(mod.checkDependencySatisfaction([{ name: "b", version: "2.0.0" }]), "wrong_version");
			});
		});
	});
});
