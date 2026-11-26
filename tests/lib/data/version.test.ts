import t from "tap";
import * as lib from "@clusterio/lib";

const { ModVersionEquality, ModVersionRange } = lib;

function eq(spec: string) {
	return ModVersionEquality.fromString(spec);
}

function int(version: string) {
	return lib.integerPartialVersion(version as lib.PartialVersion);
}

function src(version: string) {
	return version as lib.SourceVersion;
}

t.test("isVersionEquality()", async t1 => {
	t1.test("accepts the five equalities", async t2 => {
		for (const equality of ["<", "<=", "=", ">=", ">"]) {
			t2.equal(lib.isVersionEquality(equality), true, equality);
		}
	});
	t1.test("rejects anything else", async t2 => {
		for (const equality of ["", "==", "!=", "=>", "~"]) {
			t2.equal(lib.isVersionEquality(equality), false, equality);
		}
	});
});

t.test("normaliseSourceVersion()", async t1 => {
	t1.test("reads versions the lenient way the game does", async t2 => {
		t2.equal(lib.normaliseSourceVersion("1.2.3"), "1.2.3");
		t2.equal(lib.normaliseSourceVersion(" 01. 02. 03-beta"), "1.2.3");
		t2.equal(lib.normaliseSourceVersion("1.2"), "1.2.0");
	});
	t1.test("returns undefined without a major and minor", async t2 => {
		t2.equal(lib.normaliseSourceVersion("1"), undefined);
		t2.equal(lib.normaliseSourceVersion("v1.2.3"), undefined);
	});
});

t.test("isSourceVersion()", async t1 => {
	t1.test("accepts anything starting with major.minor", async t2 => {
		t2.equal(lib.isSourceVersion(" 1.2.3 trailing"), true);
		t2.equal(lib.isSourceVersion("x1.2"), false);
	});
});

t.test("integerSourceVersion()", async t1 => {
	t1.test("compares equal to the normalised full version", async t2 => {
		t2.equal(lib.integerSourceVersion(src("01.02.03")), lib.integerFullVersion("1.2.3"));
		t2.equal(lib.integerSourceVersion(src("1.2")), lib.integerFullVersion("1.2.0"));
	});
});

t.test("isFullVersion()", async t1 => {
	t1.test("requires exactly three parts", async t2 => {
		t2.equal(lib.isFullVersion("1.2.3"), true);
		t2.equal(lib.isFullVersion("1.2"), false);
		t2.equal(lib.isFullVersion("1.2.3.4"), false);
		t2.equal(lib.isFullVersion(" 1.2.3"), false);
	});
});

t.test("integerFullVersion()", async t1 => {
	t1.test("orders by major, then minor, then patch", async t2 => {
		const sorted = ["0.0.1", "0.1.0", "0.1.65535", "1.0.0", "1.65535.0", "65535.0.0"] as lib.FullVersion[];
		const ints = sorted.map(v => lib.integerFullVersion(v));
		t2.strictSame([...ints].sort((a, b) => a - b), ints);
		t2.equal(new Set(ints).size, ints.length);
	});
});

t.test("normaliseFullVersion()", async t1 => {
	t1.test("adds a zero patch to major.minor", async t2 => {
		t2.equal(lib.normaliseFullVersion("1.1"), "1.1.0");
	});
	t1.test("keeps full versions as they are", async t2 => {
		t2.equal(lib.normaliseFullVersion("1.1.5"), "1.1.5");
	});
});

t.test("isMajorMinorVersion()", async t1 => {
	t1.test("requires exactly two parts", async t2 => {
		t2.equal(lib.isMajorMinorVersion("2.0"), true);
		t2.equal(lib.isMajorMinorVersion("2.0.0"), false);
		t2.equal(lib.isMajorMinorVersion("2"), false);
		t2.equal(lib.isMajorMinorVersion("a.b"), false);
	});
});

t.test("integerMajorMinorVersion()", async t1 => {
	t1.test("equals the full version with a zero patch", async t2 => {
		t2.equal(lib.integerMajorMinorVersion("1.2"), lib.integerFullVersion("1.2.0"));
	});
	t1.test("orders by major, then minor", async t2 => {
		t2.ok(lib.integerMajorMinorVersion("0.18") < lib.integerMajorMinorVersion("1.0"));
		t2.ok(lib.integerMajorMinorVersion("1.1") < lib.integerMajorMinorVersion("1.10"));
	});
});

t.test("normaliseMajorMinorVersion()", async t1 => {
	t1.test("drops the patch", async t2 => {
		t2.equal(lib.normaliseMajorMinorVersion("1.1.110"), "1.1");
		t2.equal(lib.normaliseMajorMinorVersion("2.0"), "2.0");
	});
});

t.test("isPartialVersion()", async t1 => {
	t1.test("accepts two or three parts", async t2 => {
		t2.equal(lib.isPartialVersion("1.1"), true);
		t2.equal(lib.isPartialVersion("1.1.0"), true);
		t2.equal(lib.isPartialVersion("1"), false);
		t2.equal(lib.isPartialVersion("1.1.0.0"), false);
	});
});

t.test("integerPartialVersion()", async t1 => {
	t1.test("treats a missing patch as zero", async t2 => {
		t2.equal(int("1.1"), int("1.1.0"));
		t2.ok(int("1.1") < int("1.1.1"));
	});
});

t.test("isReleaseChannel()", async t1 => {
	t1.test("accepts lowercase identifiers", async t2 => {
		t2.equal(lib.isReleaseChannel("stable"), true);
		t2.equal(lib.isReleaseChannel("experimental"), true);
		t2.equal(lib.isReleaseChannel("x-2"), true);
	});
	t1.test("rejects latest, versions and other strings", async t2 => {
		t2.equal(lib.isReleaseChannel("latest"), false);
		t2.equal(lib.isReleaseChannel("2.0"), false);
		t2.equal(lib.isReleaseChannel("Stable"), false);
		t2.equal(lib.isReleaseChannel("-stable"), false);
	});
});

t.test("isTargetVersion()", async t1 => {
	t1.test("accepts versions, latest and release channels", async t2 => {
		t2.equal(lib.isTargetVersion("latest"), true);
		t2.equal(lib.isTargetVersion("stable"), true);
		t2.equal(lib.isTargetVersion("2.0"), true);
		t2.equal(lib.isTargetVersion("2.0.1"), true);
	});
	t1.test("rejects other strings", async t2 => {
		t2.equal(lib.isTargetVersion("2"), false);
		t2.equal(lib.isTargetVersion("Latest"), false);
		t2.equal(lib.isTargetVersion(""), false);
	});
});

t.test("ModVersionEquality", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("stores the equality, version and integer version", async t3 => {
			const equality = new ModVersionEquality(">=", "1.1");
			t3.equal(equality.equality, ">=");
			t3.equal(equality.version, "1.1");
			t3.equal(equality.integerVersion, int("1.1.0"));
		});
		t2.test("throws on an invalid equality", async t3 => {
			t3.throws(() => new ModVersionEquality("==" as any, "1.1"), new Error("Invalid equality"));
		});
		t2.test("throws on an invalid version", async t3 => {
			t3.throws(() => new ModVersionEquality("=", "1" as any), new Error("Invalid version"));
		});
	});

	t1.test("testIntegerVersion()", async t2 => {
		const cases: [string, boolean, boolean, boolean][] = [
			// equality, result for 1.0.0, 1.1.0, 1.2.0
			["<", true, false, false],
			["<=", true, true, false],
			["=", false, true, false],
			[">=", false, true, true],
			[">", false, false, true],
		];
		for (const [equality, below, same, above] of cases) {
			t2.test(`tests ${equality} against the version`, async t3 => {
				const versionEquality = eq(`${equality} 1.1.0`);
				t3.equal(versionEquality.testIntegerVersion(int("1.0.0")), below, "below");
				t3.equal(versionEquality.testIntegerVersion(int("1.1.0")), same, "same");
				t3.equal(versionEquality.testIntegerVersion(int("1.2.0")), above, "above");
			});
		}
		t2.test("throws if equality was changed to an invalid value", async t3 => {
			const versionEquality = eq("> 1.1.0");
			versionEquality.equality = "==" as any;
			t3.throws(() => versionEquality.testIntegerVersion(int("1.0.0")), new Error("unreachable"));
		});
	});

	t1.test("testVersion()", async t2 => {
		t2.test("reads the version leniently", async t3 => {
			const versionEquality = eq("= 1.1.0");
			t3.equal(versionEquality.testVersion(src("01.1")), true);
			t3.equal(versionEquality.testVersion(src(" 1.01.0-rc1")), true);
			t3.equal(versionEquality.testVersion(src("1.1.1")), false);
		});
	});

	t1.test("toString()", async t2 => {
		t2.test("joins equality and version with a space", async t3 => {
			t3.equal(new ModVersionEquality("<", "2.0").toString(), "< 2.0");
		});
	});

	t1.test("ModVersionEquality.fromString()", async t2 => {
		t2.test("defaults to = without an equality", async t3 => {
			const versionEquality = ModVersionEquality.fromString("1.2.3");
			t3.equal(versionEquality.equality, "=");
			t3.equal(versionEquality.version, "1.2.3");
		});
		t2.test("parses equality and version", async t3 => {
			const versionEquality = ModVersionEquality.fromString("> 1.2");
			t3.equal(versionEquality.equality, ">");
			t3.equal(versionEquality.version, "1.2");
		});
	});

	t1.test("ModVersionEquality.fromParts()", async t2 => {
		t2.test("throws on an invalid equality", async t3 => {
			t3.throws(
				() => ModVersionEquality.fromParts("=>", "1.0"),
				new Error('Invalid version equality "=>"'),
			);
		});
		t2.test("throws on an invalid version", async t3 => {
			t3.throws(
				() => ModVersionEquality.fromParts(">=", "1"),
				new Error('Invalid version string "1"'),
			);
		});
	});
});

t.test("ModVersionRange", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults to every version", async t3 => {
			const range = new ModVersionRange();
			t3.equal(range.valid, true);
			t3.equal(range.testVersion("0.0.0"), true);
			t3.equal(range.testVersion("65535.65535.65535"), true);
		});
		t2.test("throws if the minimum uses < or <=", async t3 => {
			for (const equality of ["<", "<="]) {
				t3.throws(
					() => new ModVersionRange(eq(`${equality} 1.0`)),
					new Error("Minimum version can not use < or <="),
				);
			}
		});
		t2.test("throws if the maximum uses > or >=", async t3 => {
			for (const equality of [">", ">="]) {
				t3.throws(
					() => new ModVersionRange(undefined, eq(`${equality} 1.0`)),
					new Error("Maximum version can not use > or >="),
				);
			}
		});
	});

	t1.test("valid", async t2 => {
		t2.test("is true when the bounds overlap", async t3 => {
			t3.equal(new ModVersionRange(eq(">= 1.0"), eq("<= 1.0")).valid, true);
			t3.equal(new ModVersionRange(eq("> 1.0"), eq("< 2.0")).valid, true);
		});
		t2.test("is false when the bounds do not overlap", async t3 => {
			t3.equal(new ModVersionRange(eq(">= 2.0"), eq("<= 1.0")).valid, false);
			t3.equal(new ModVersionRange(eq("> 1.0"), eq("<= 1.0")).valid, false);
			t3.equal(new ModVersionRange(eq(">= 1.0"), eq("< 1.0")).valid, false);
		});
		t2.test("handles = on either bound", async t3 => {
			t3.equal(new ModVersionRange(eq(">= 1.0"), eq("= 2.0")).valid, true);
			t3.equal(new ModVersionRange(eq("= 1.0"), eq("<= 2.0")).valid, true);
			t3.equal(new ModVersionRange(eq("= 1.0"), eq("= 1.0")).valid, true);
			t3.equal(new ModVersionRange(eq("= 1.0"), eq("= 2.0")).valid, false);
			t3.equal(new ModVersionRange(eq("> 2.0"), eq("= 2.0")).valid, false);
			t3.equal(new ModVersionRange(eq("= 2.0"), eq("< 2.0")).valid, false);
		});
		t2.test("is false when no integer version fits between exclusive bounds", async t3 => {
			const range = new ModVersionRange(eq("> 1.0.0"), eq("< 1.0.1"));
			t3.equal(range.testVersion("1.0.0") || range.testVersion("1.0.1"), false);
			t3.equal(range.valid, false);
		});
	});

	t1.test("invalidate()", async t2 => {
		t2.test("makes the range reject every version", async t3 => {
			const range = new ModVersionRange();
			range.invalidate();
			t3.equal(range.valid, false);
			t3.equal(range.testVersion("0.0.0"), false);
			t3.equal(range.testVersion("1.0.0"), false);
		});
	});

	t1.test("testIntegerVersion()", async t2 => {
		t2.test("requires both bounds to pass", async t3 => {
			const range = new ModVersionRange(eq(">= 1.0"), eq("< 2.0"));
			t3.equal(range.testIntegerVersion(int("0.18")), false);
			t3.equal(range.testIntegerVersion(int("1.0")), true);
			t3.equal(range.testIntegerVersion(int("1.99.99")), true);
			t3.equal(range.testIntegerVersion(int("2.0")), false);
		});
	});

	t1.test("testVersion()", async t2 => {
		t2.test("accepts partial versions", async t3 => {
			const range = new ModVersionRange(eq(">= 1.1"), eq("<= 1.1"));
			t3.equal(range.testVersion("1.1"), true);
			t3.equal(range.testVersion("1.1.1"), false);
		});
		t2.test("reads source versions leniently", async t3 => {
			const range = new ModVersionRange(eq(">= 1.1"), eq("<= 1.1"));
			t3.equal(range.testVersion(src(" 01.01.00-rc")), true);
			t3.equal(range.testVersion(src(" 1.2")), false);
		});
	});

	t1.test("combineVersion()", async t2 => {
		function range(min: string, max: string) {
			return new ModVersionRange(eq(min), eq(max));
		}
		function bounds(r: InstanceType<typeof ModVersionRange>) {
			return [r.minVersion.toString(), r.maxVersion.toString()];
		}

		t2.test("< lowers the maximum", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq("< 2.0"));
			t3.strictSame(bounds(r), [">= 1.0", "< 2.0"]);
		});
		t2.test("< keeps a lower maximum", async t3 => {
			const r = range(">= 1.0", "< 1.5");
			r.combineVersion(eq("< 2.0"));
			t3.strictSame(bounds(r), [">= 1.0", "< 1.5"]);
		});
		t2.test("<= lowers the maximum", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq("<= 1.5"));
			t3.strictSame(bounds(r), [">= 1.0", "<= 1.5"]);
		});
		t2.test("<= keeps a stricter maximum at the same version", async t3 => {
			const r = range(">= 1.0", "< 2.0");
			r.combineVersion(eq("<= 2.0"));
			t3.strictSame(bounds(r), [">= 1.0", "< 2.0"]);
		});
		t2.test("= narrows to a version inside the range", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq("= 1.5"));
			t3.strictSame(bounds(r), ["= 1.5", "= 1.5"]);
			t3.equal(r.valid, true);
			t3.equal(r.testVersion("1.5"), true);
			t3.equal(r.testVersion("1.6"), false);
		});
		t2.test("= outside the range invalidates it", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq("= 3.0"));
			t3.equal(r.valid, false);
			t3.equal(r.testVersion("3.0"), false);
		});
		t2.test("throws if equality was changed to an invalid value", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			const other = eq("> 1.5");
			other.equality = "==" as any;
			t3.throws(() => r.combineVersion(other), new Error("unreachable"));
		});
		t2.test(">= raises the minimum", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq(">= 1.5"));
			t3.strictSame(bounds(r), [">= 1.5", "<= 2.0"]);
		});
		t2.test(">= keeps a stricter minimum at the same version", async t3 => {
			const r = range("> 1.0", "<= 2.0");
			r.combineVersion(eq(">= 1.0"));
			t3.strictSame(bounds(r), ["> 1.0", "<= 2.0"]);
		});
		t2.test("> raises the minimum", async t3 => {
			const r = range(">= 1.0", "<= 2.0");
			r.combineVersion(eq("> 1.0"));
			t3.strictSame(bounds(r), ["> 1.0", "<= 2.0"]);
		});
		t2.test("> keeps a higher minimum", async t3 => {
			const r = range(">= 1.5", "<= 2.0");
			r.combineVersion(eq("> 1.0"));
			t3.strictSame(bounds(r), [">= 1.5", "<= 2.0"]);
		});
		t2.test("conflicting bounds make the range invalid", async t3 => {
			const r = new ModVersionRange();
			r.combineVersion(eq(">= 2.0"));
			r.combineVersion(eq("< 1.0"));
			t3.equal(r.valid, false);
		});
	});
});
