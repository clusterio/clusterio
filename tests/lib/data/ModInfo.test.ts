import t from "tap";
import * as lib from "@clusterio/lib";

const { ModInfo, ModDependency } = lib;

function src(version: string) {
	return version as lib.SourceVersion;
}

function mod(name: string, version = "1.0.0") {
	return ModInfo.fromJSON({ name, version: src(version), title: name, author: "a" });
}

function record(name: string, version = "1.0.0"): lib.ModRecord {
	return { name, version: src(version), enabled: true };
}

t.test("ModDependency", async t1 => {
	t1.test("ModDependency.getTypeFromPrefix()", async t2 => {
		t2.test("maps each prefix to its type", async t3 => {
			t3.equal(ModDependency.getTypeFromPrefix("!"), "incompatible");
			t3.equal(ModDependency.getTypeFromPrefix("?"), "optional");
			t3.equal(ModDependency.getTypeFromPrefix("(?)"), "hidden");
			t3.equal(ModDependency.getTypeFromPrefix("~"), "unordered");
			t3.equal(ModDependency.getTypeFromPrefix("+"), "recommended");
			t3.equal(ModDependency.getTypeFromPrefix(""), "required");
		});
		t2.test("throws on an unknown prefix", async t3 => {
			t3.throws(() => ModDependency.getTypeFromPrefix("&"), new Error('Invalid dependency prefix "&"'));
		});
	});

	t1.test("constructor", async t2 => {
		t2.test("parses prefix, name and version", async t3 => {
			const dependency = new ModDependency("~ my mod >= 1.2.3");
			t3.equal(dependency.spec, "~ my mod >= 1.2.3");
			t3.equal(dependency.type, "unordered");
			t3.equal(dependency.name, "my mod");
			t3.equal(dependency.version?.toString(), ">= 1.2.3");
		});
		t2.test("parses a recommended dependency", async t3 => {
			const dependency = new ModDependency("+ helper");
			t3.equal(dependency.type, "recommended");
			t3.equal(dependency.name, "helper");
			t3.equal(dependency.version, undefined);
		});
		t2.test("ignores the version of incompatible dependencies", async t3 => {
			const dependency = new ModDependency("! other < 2.0");
			t3.equal(dependency.type, "incompatible");
			t3.equal(dependency.name, "other");
			t3.equal(dependency.version, undefined);
		});
		t2.test("throws on an empty specification", async t3 => {
			t3.throws(() => new ModDependency(""), new Error('Invalid dependency specification ""'));
		});
		t2.test("throws on an invalid version", async t3 => {
			t3.throws(() => new ModDependency("a > 1"), new Error('Invalid version string "1"'));
		});
	});

	t1.test("checkUnsatisfiedReason()", async t2 => {
		t2.test("reports missing required and unordered dependencies", async t3 => {
			t3.equal(new ModDependency("a").checkUnsatisfiedReason([]), "missing_dependency");
			t3.equal(new ModDependency("~ a").checkUnsatisfiedReason([]), "missing_dependency");
		});
		t2.test("accepts missing optional, hidden, recommended and incompatible dependencies", async t3 => {
			for (const spec of ["? a", "(?) a", "+ a", "! a"]) {
				t3.equal(new ModDependency(spec).checkUnsatisfiedReason([]), undefined, spec);
			}
		});
		t2.test("reports a present incompatible mod", async t3 => {
			t3.equal(new ModDependency("! a").checkUnsatisfiedReason([mod("a")]), "incompatible");
		});
		t2.test("reports a present mod of the wrong version", async t3 => {
			for (const spec of ["a >= 2.0", "? a >= 2.0", "+ a >= 2.0"]) {
				t3.equal(new ModDependency(spec).checkUnsatisfiedReason([mod("a")]), "wrong_version", spec);
			}
		});
		t2.test("accepts a present mod of the right version", async t3 => {
			t3.equal(new ModDependency("a >= 1.0").checkUnsatisfiedReason([mod("b"), mod("a")]), undefined);
			t3.equal(new ModDependency("a").checkUnsatisfiedReason([mod("a")]), undefined);
		});
		t2.test("works on mod pack records", async t3 => {
			t3.equal(new ModDependency("a = 1.0.0").checkUnsatisfiedReason([record("a", "1.0.0")]), undefined);
			t3.equal(new ModDependency("a = 1.0.0").checkUnsatisfiedReason([record("a", "1.0.1")]), "wrong_version");
		});
	});

	t1.test("isSatisfied()", async t2 => {
		t2.test("is true when there is no unsatisfied reason", async t3 => {
			t3.equal(new ModDependency("a").isSatisfied([mod("a")]), true);
			t3.equal(new ModDependency("a").isSatisfied([]), false);
			t3.equal(new ModDependency("! a").isSatisfied([mod("a")]), false);
		});
	});

	t1.test("type getters", async t2 => {
		t2.test("classify each dependency type", async t3 => {
			const cases: [string, boolean, boolean, boolean, boolean][] = [
				// spec, incompatible, recommended, required, optional
				["! a", true, false, false, false],
				["? a", false, false, false, true],
				["(?) a", false, false, false, true],
				["~ a", false, false, true, false],
				["+ a", false, true, false, false],
				["a", false, false, true, false],
			];
			for (const [spec, incompatible, recommended, required, optional] of cases) {
				const dependency = new ModDependency(spec);
				t3.strictSame(
					[dependency.incompatible, dependency.recommended, dependency.required, dependency.optional],
					[incompatible, recommended, required, optional],
					spec,
				);
			}
		});
	});
});

t.test("ModInfo", async t1 => {
	t1.test("getters", async t2 => {
		t2.test("derive id, filename and versions from the fields", async t3 => {
			const info = ModInfo.fromJSON({
				name: "my-mod", version: src(" 01.2.3-rc"), title: "", author: "", factorio_version: src("2.0.11"),
			});
			t3.equal(info.id, "my-mod_ 01.2.3-rc");
			t3.equal(info.filename, "my-mod_ 01.2.3-rc.zip");
			t3.equal(info.normalisedVersion, "1.2.3");
			t3.equal(info.integerVersion, lib.integerFullVersion("1.2.3"));
			t3.equal(info.factorioVersion, "2.0");
			t3.equal(info.integerFactorioVersion, lib.integerMajorMinorVersion("2.0"));
		});
		t2.test("list dependency specifications", async t3 => {
			const info = ModInfo.fromJSON({
				name: "a", version: src("1.0.0"), title: "", author: "", dependencies: ["base >= 2.0", "? b"],
			});
			t3.strictSame(info.dependencySpecifications, ["base >= 2.0", "? b"]);
		});
	});

	t1.test("ModInfo.filename()", async t2 => {
		t2.test("joins name and version", async t3 => {
			t3.equal(ModInfo.filename("a", src("1.0.0")), "a_1.0.0.zip");
		});
	});

	t1.test("checkDependencySatisfaction()", async t2 => {
		function withDeps(...dependencies: string[]) {
			return ModInfo.fromJSON({ name: "x", version: src("1.0.0"), title: "", author: "", dependencies });
		}
		t2.test("returns undefined when every dependency is satisfied", async t3 => {
			t3.equal(withDeps("a", "? b", "! c").checkDependencySatisfaction([mod("a")]), undefined);
		});
		t2.test("returns the most severe reason", async t3 => {
			const mods = [mod("a"), mod("c")];
			t3.equal(withDeps("a >= 2.0", "b", "! c").checkDependencySatisfaction(mods), "incompatible");
			t3.equal(withDeps("! c", "b", "a >= 2.0").checkDependencySatisfaction(mods), "incompatible");
			t3.equal(withDeps("a >= 2.0", "b").checkDependencySatisfaction(mods), "missing_dependency");
			t3.equal(withDeps("b", "a >= 2.0").checkDependencySatisfaction(mods), "missing_dependency");
			t3.equal(withDeps("a >= 2.0").checkDependencySatisfaction(mods), "wrong_version");
		});
	});

	t1.test("ModInfo.fromJSON()", async t2 => {
		t2.test("throws on an unparseable version", async t3 => {
			t3.throws(
				() => ModInfo.fromJSON({ name: "a", version: src("one"), title: "", author: "" }),
				new Error('Invalid mod version "one"'),
			);
		});
		t2.test("throws on an unparseable factorio_version", async t3 => {
			t3.throws(
				() => ModInfo.fromJSON({
					name: "a", version: src("1.0.0"), title: "", author: "", factorio_version: src("two"),
				}),
				new Error('Invalid factorio_version "two"'),
			);
		});
		t2.test("throws on an invalid dependency, naming the mod", async t3 => {
			t3.throws(
				() => ModInfo.fromJSON({
					name: "a", version: src("1.0.0"), title: "", author: "", dependencies: ["base", ""],
				}),
				new Error('Failed to parse dependencies for a: Error: Invalid dependency specification ""'),
			);
		});
		t2.test("keeps the default fields for empty values", async t3 => {
			const info = ModInfo.fromJSON({ name: "", version: src(""), title: "", author: "" });
			t3.equal(info.version, "0.0.0");
			t3.equal(info.factorioVersion, "0.12");
			t3.strictSame(info.dependencySpecifications, ["base"]);
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("writes dependencies other than the default base", async t3 => {
			const info = mod("a");
			t3.equal(info.toJSON().dependencies, undefined);
			info.dependencies = [];
			t3.strictSame(info.toJSON().dependencies, []);
			info.dependencies = [new ModDependency("base >= 1.1")];
			t3.strictSame(
				info.toJSON().dependencies,
				["base >= 1.1"],
			);
		});
	});
});
