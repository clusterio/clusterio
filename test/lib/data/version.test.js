"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const { testMatrix, testRoundTripJsonSerialisable } = require("../../common");

describe("lib/data/version", function() {
	describe("isVersionEquality()", function() {
		it("should correctly validate input strings", function() {
			const valid = ["<", "<=", "=", ">=", ">"];
			for (const test of valid) {
				assert.equal(lib.isVersionEquality(test), true, test);
			}
			const invalid = ["==", "!=", "<>", ""];
			for (const test of invalid) {
				assert.equal(lib.isVersionEquality(test), false, test);
			}
		});
	});
	describe("isApiVersion()", function() {
		it("should correctly validate input strings", function() {
			const valid = ["0.13", "0.14", "0.15", "0.16", "0.17", "0.18", "1.0", "1.1", "2.0"];
			for (const test of valid) {
				assert.equal(lib.isApiVersion(test), true, test);
			}
			const invalid = ["0.12", "0.19", "1.2", "2.1", "1.0.0", "1.0.0.0", "0", "", "latest"];
			for (const test of invalid) {
				assert.equal(lib.isApiVersion(test), false, test);
			}
		});
	});
	describe("normaliseApiVersion()", function() {
		it("should normalise accepted versions", function() {
			assert.equal(lib.normaliseApiVersion("0.13"), "0.13");
			assert.equal(lib.normaliseApiVersion("0.13.0"), "0.13");
			assert.equal(lib.normaliseApiVersion("0.13.1"), "0.13");
			assert.equal(lib.normaliseApiVersion("1.1"), "1.1");
			assert.equal(lib.normaliseApiVersion("1.1.0"), "1.1");
			assert.equal(lib.normaliseApiVersion("1.1.1"), "1.1");
			assert.equal(lib.normaliseApiVersion("2.0"), "2.0");
			assert.equal(lib.normaliseApiVersion("2.0.0"), "2.0");
			assert.equal(lib.normaliseApiVersion("2.0.1"), "2.0");
			assert.equal(lib.normaliseApiVersion("1.0.0.0"), "1.0");
		});
		it("should throw for invalid versions", function() {
			const invalid = ["0.12", "0", "", "latest"];
			for (const test of invalid) {
				assert.throws(() => lib.normaliseApiVersion(test), undefined, test);
			}
		});
	});
	describe("isFullVersion()", function() {
		it("should correctly validate input strings", function() {
			const valid = ["0.12.0", "0.13.1", "0.17.99", "00.000.0001", "1.1.110"];
			for (const test of valid) {
				assert.equal(lib.isFullVersion(test), true, test);
			}
			const invalid = ["0.12", "0.19", "1.0", "1.0.0.0", "0", "", "latest"];
			for (const test of invalid) {
				assert.equal(lib.isFullVersion(test), false, test);
			}
		});
	});
	describe("integerFullVersion()", function() {
		it("should sort versions lexicographically", function() {
			let unsortedVersions = ["1.0.0", "1.1.0", "0.1.0", "3.0.0", "1.2.0", "0.3.1", "0.3.3", "2.1.1", "0.0.1"];
			let sortedVersions = ["0.0.1", "0.1.0", "0.3.1", "0.3.3", "1.0.0", "1.1.0", "1.2.0", "2.1.1", "3.0.0"];
			unsortedVersions.sort((a, b) => lib.integerFullVersion(a) - lib.integerFullVersion(b));
			assert.deepEqual(unsortedVersions, sortedVersions);
		});
	});
	describe("normaliseFullVersion()", function() {
		it("should normalise accepted versions", function() {
			assert.equal(lib.normaliseFullVersion("0.13"), "0.13.0");
			assert.equal(lib.normaliseFullVersion("0.13.0"), "0.13.0");
			assert.equal(lib.normaliseFullVersion("0.13.1"), "0.13.1");
			assert.equal(lib.normaliseFullVersion("1.1"), "1.1.0");
			assert.equal(lib.normaliseFullVersion("1.1.0"), "1.1.0");
			assert.equal(lib.normaliseFullVersion("1.1.1"), "1.1.1");
			assert.equal(lib.normaliseFullVersion("2.0"), "2.0.0");
			assert.equal(lib.normaliseFullVersion("2.0.0"), "2.0.0");
			assert.equal(lib.normaliseFullVersion("2.0.1"), "2.0.1");
		});
	});
	describe("isPartialVersion()", function() {
		it("should correctly validate input strings", function() {
			const valid = [
				"0.13", "0.14", "0.15", "0.16", "0.17", "0.18", "1.0", "1.1", "2.0",
				"0.12.0", "0.13.1", "0.17.99", "00.000.0001", "1.1.110",
			];
			for (const test of valid) {
				assert.equal(lib.isPartialVersion(test), true, test);
			}
			const invalid = ["1.0.0.0", "0", "", "latest"];
			for (const test of invalid) {
				assert.equal(lib.isPartialVersion(test), false, test);
			}
		});
	});
	describe("integerPartialVersion()", function() {
		it("should sort versions lexicographically", function() {
			let unsortedVersions = ["1.0", "1.1", "0.1", "3.0", "1.2", "0.3", "2.1"];
			let sortedVersions = ["0.1", "0.3", "1.0", "1.1", "1.2", "2.1", "3.0"];
			unsortedVersions.sort((a, b) => lib.integerPartialVersion(a) - lib.integerPartialVersion(b));
			assert.deepEqual(unsortedVersions, sortedVersions);
		});
	});
	describe("isTargetVersion()", function() {
		it("should correctly validate input strings", function() {
			const valid = [
				"0.13", "0.14", "0.15", "0.16", "0.17", "0.18", "1.0", "1.1", "2.0",
				"0.12.0", "0.13.1", "0.17.99", "00.000.0001", "1.1.110", "latest",
			];
			for (const test of valid) {
				assert.equal(lib.isTargetVersion(test), true, test);
			}
			const invalid = ["1.0.0.0", "0", ""];
			for (const test of invalid) {
				assert.equal(lib.isTargetVersion(test), false, test);
			}
		});
	});
	describe("class ModVersionEquality", function() {
		const tests = testMatrix(
			["<", "<=", "=", ">=", ">"],
			["0.18", "1.0", "1.0.0", "1.1.1"],
		);
		describe("constructor", function() {
			it("should be round trip json serialisable", function() {
				testRoundTripJsonSerialisable(lib.ModVersionEquality, tests);
			});
			it("should be constructible", function() {
				for (const [eq, ver] of tests) {
					const test = `${eq} ${ver}`;
					const version = new lib.ModVersionEquality(eq, ver);
					assert.equal(version.equality, eq, test);
					assert.equal(version.version, ver, test);
					assert.equal(version.integerVersion, lib.integerPartialVersion(ver), test);
				}
			});
			it("should throw when given an invalid equality", function() {
				assert.throws(() => new lib.ModVersionEquality("==", "1.0.0"));
			});
			it("should throw when given an invalid version", function() {
				assert.throws(() => new lib.ModVersionEquality("=", "1.0.0.0"));
			});
		});
		describe("testIntegerVersion()", function() {
			it("should test for less than", function() {
				const version = new lib.ModVersionEquality("<", "0.0.100");
				assert.equal(version.testIntegerVersion(90), true);
				assert.equal(version.testIntegerVersion(100), false);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for less than equal", function() {
				const version = new lib.ModVersionEquality("<=", "0.0.100");
				assert.equal(version.testIntegerVersion(90), true);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for equal", function() {
				const version = new lib.ModVersionEquality("=", "0.0.100");
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for greater than equal", function() {
				const version = new lib.ModVersionEquality(">=", "0.0.100");
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), true);
			});
			it("should test for greater than", function() {
				const version = new lib.ModVersionEquality(">", "0.0.100");
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), false);
				assert.equal(version.testIntegerVersion(110), true);
			});
			it("should throw if the equality is invalid (unreachable)", function() {
				const version = new lib.ModVersionEquality(">", "0.0.100");
				version.equality = "==";
				assert.throws(() => version.testIntegerVersion(100));
			});
		});
		describe("testVersion()", function() {
			it("should test for less than", function() {
				const version = new lib.ModVersionEquality("<", "1.1.1");
				assert.equal(version.testVersion("1.0"), true);
				assert.equal(version.testVersion("1.1"), true);
				assert.equal(version.testVersion("1.1.1"), false);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for less than equal", function() {
				const version = new lib.ModVersionEquality("<=", "1.1.1");
				assert.equal(version.testVersion("1.0"), true);
				assert.equal(version.testVersion("1.1"), true);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for equal", function() {
				const version = new lib.ModVersionEquality("=", "1.1.1");
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for greater than equal", function() {
				const version = new lib.ModVersionEquality(">=", "1.1.1");
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), true);
				assert.equal(version.testVersion("1.2"), true);
			});
			it("should test for greater than", function() {
				const version = new lib.ModVersionEquality(">", "1.1.1");
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), false);
				assert.equal(version.testVersion("1.1.2"), true);
				assert.equal(version.testVersion("1.2"), true);
			});
			it("should throw if the equality is invalid (unreachable)", function() {
				const version = new lib.ModVersionEquality(">", "1.1.1");
				version.equality = "==";
				assert.throws(() => version.testInteger("1.0.0"));
			});
		});
		describe("toString()", function() {
			it("should be convertible to string", function() {
				for (const [eq, ver] of tests) {
					const expected = `${eq} ${ver}`;
					const version = new lib.ModVersionEquality(eq, ver);
					assert.equal(version.toString(), expected);
				}
			});
		});
		describe("fromString()", function() {
			it("should be constructable from string", function() {
				for (const [eq, ver] of tests) {
					const test = `${eq} ${ver}`;
					const version = lib.ModVersionEquality.fromString(test);
					assert.equal(version.equality, eq, test);
					assert.equal(version.version, ver, test);
					assert.equal(version.integerVersion, lib.integerPartialVersion(ver), test);
				}
			});
			it("should error for invalid equalities", function() {
				const equalities = ["==", "!=", "<>", ""];
				for (const eq of equalities) {
					const test = `${eq} 1.0.0`;
					assert.throws(() => lib.ModVersionEquality.fromString(test), undefined, test);
				}
			});
			it("should error for invalid versions", function() {
				const versions = ["1.0.0.0", "0", "", "latest"];
				for (const ver of versions) {
					const test = `= ${ver}`;
					assert.throws(() => lib.ModVersionEquality.fromString(test), undefined, test);
				}
			});
		});
		describe("fromParts()", function() {
			it("should be constructable from parts", function() {
				for (const [eq, ver] of tests) {
					const test = `${eq} ${ver}`;
					const version = lib.ModVersionEquality.fromParts(eq, ver);
					assert.equal(version.equality, eq, test);
					assert.equal(version.version, ver, test);
					assert.equal(version.integerVersion, lib.integerPartialVersion(ver), test);
				}
			});
			it("should error for invalid equalities", function() {
				const equalities = ["==", "!=", "<>", ""];
				for (const eq of equalities) {
					assert.throws(() => lib.ModVersionEquality.fromParts(eq, "1.0.0"), undefined, eq);
				}
			});
			it("should error for invalid versions", function() {
				const versions = ["1.0.0.0", "0", "", "latest"];
				for (const ver of versions) {
					assert.throws(() => lib.ModVersionEquality.fromParts("=", ver), undefined, ver);
				}
			});
		});
	});
	describe("class ModVersionRange", function() {
		describe("constructor", function() {
			it("should be constructable", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				assert.equal(range.minVersion.equality, ">=");
				assert.equal(range.minVersion.version, "1.0.0");
				assert.equal(range.maxVersion.equality, "<");
				assert.equal(range.maxVersion.version, "2.0.0");
			});
			it("should be default constructable", function() {
				const range = new lib.ModVersionRange();
				assert.equal(range.minVersion.equality, ">=");
				assert.equal(range.minVersion.version, "0.0.0");
				assert.equal(range.maxVersion.equality, "<=");
				assert.equal(range.maxVersion.version, "65535.65535.65535");
			});
			it("should throw if invalid equality is given for min version", function() {
				assert.throws(() => new lib.ModVersionRange(
					new lib.ModVersionEquality("<", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				));
				assert.throws(() => new lib.ModVersionRange(
					new lib.ModVersionEquality("<=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				));
			});
			it("should throw if invalid equality is given for max version", function() {
				assert.throws(() => new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality(">", "2.0.0"),
				));
				assert.throws(() => new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality(">=", "2.0.0"),
				));
			});
		});
		describe("valid", function() {
			it("should be true for valid ranges", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				assert.equal(range.valid, true);

				const defaultRange = new lib.ModVersionRange();
				assert.equal(defaultRange.valid, true);
			});
			it("should be false for invalid ranges", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "2.0.0"),
					new lib.ModVersionEquality("<", "1.0.0"),
				);
				assert.equal(range.valid, false);

				const rangeImpossible = new lib.ModVersionRange(
					new lib.ModVersionEquality("=", "1.0.0"),
					new lib.ModVersionEquality("=", "2.0.0"),
				);
				assert.equal(rangeImpossible.valid, false);
			});
		});
		describe("invalidate()", function() {
			it("should result in the range becoming invalid", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				range.invalidate();
				assert.equal(range.valid, false);

				const defaultRange = new lib.ModVersionRange();
				defaultRange.invalidate();
				assert.equal(defaultRange.valid, false);
			});
		});
		describe("testIntegerVersion()", function() {
			it("should return true when in range", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "0.0.100"),
					new lib.ModVersionEquality("<", "0.0.200"),
				);
				assert.equal(range.testIntegerVersion(100), true);
				assert.equal(range.testIntegerVersion(199), true);
			});
			it("should return false when out of range", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "0.0.100"),
					new lib.ModVersionEquality("<", "0.0.200"),
				);
				assert.equal(range.testIntegerVersion(99), false);
				assert.equal(range.testIntegerVersion(200), false);
			});
			it("should handle exact matches", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality("=", "0.0.100"),
					new lib.ModVersionEquality("=", "0.0.100"),
				);
				assert.equal(range.testIntegerVersion(99), false);
				assert.equal(range.testIntegerVersion(100), true);
				assert.equal(range.testIntegerVersion(101), false);
			});
		});
		describe("testVersion()", function() {
			it("should return true when in range", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				assert.equal(range.testVersion("1.0.0"), true);
				assert.equal(range.testVersion("1.9.9"), true);
			});
			it("should return false when out of range", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				assert.equal(range.testVersion("0.9.9"), false);
				assert.equal(range.testVersion("2.0.0"), false);
			});
			it("should handle exact matches", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality("=", "1.0.0"),
					new lib.ModVersionEquality("=", "1.0.0"),
				);
				assert.equal(range.testVersion("0.9.9"), false);
				assert.equal(range.testVersion("1.0.0"), true);
				assert.equal(range.testVersion("1.0.1"), false);
			});
		});
		describe("combineVersion()", function() {
			it("should handle merge with less than", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);

				assert.equal(range.testVersion("1.1"), true);
				assert.equal(range.testVersion("1.5"), true);
				range.combineVersion(new lib.ModVersionEquality("<", "1.2"));
				assert.equal(range.testVersion("1.1"), true);
				assert.equal(range.testVersion("1.5"), false);

				assert.equal(range.valid, true);
				range.combineVersion(new lib.ModVersionEquality("<", "0.5"));
				assert.equal(range.valid, false);
			});
			it("should handle merge with less than equal", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);

				assert.equal(range.testVersion("1.2"), true);
				assert.equal(range.testVersion("1.5"), true);
				range.combineVersion(new lib.ModVersionEquality("<=", "1.2"));
				assert.equal(range.testVersion("1.2"), true);
				assert.equal(range.testVersion("1.5"), false);

				assert.equal(range.valid, true);
				range.combineVersion(new lib.ModVersionEquality("<=", "0.5"));
				assert.equal(range.valid, false);
			});
			it("should handle merge with equal", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);

				assert.equal(range.testVersion("1.2"), true);
				assert.equal(range.testVersion("1.5"), true);
				range.combineVersion(new lib.ModVersionEquality("=", "1.2"));
				assert.equal(range.testVersion("1.2"), true);
				assert.equal(range.testVersion("1.5"), false);

				assert.equal(range.valid, true);
				range.combineVersion(new lib.ModVersionEquality("=", "0.5"));
				assert.equal(range.valid, false);
			});
			it("should handle merge with greater than equal", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);

				assert.equal(range.testVersion("1.1"), true);
				assert.equal(range.testVersion("1.5"), true);
				range.combineVersion(new lib.ModVersionEquality(">=", "1.2"));
				assert.equal(range.testVersion("1.1"), false);
				assert.equal(range.testVersion("1.5"), true);

				assert.equal(range.valid, true);
				range.combineVersion(new lib.ModVersionEquality(">=", "2.5"));
				assert.equal(range.valid, false);
			});
			it("should handle merge with greater than", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);

				assert.equal(range.testVersion("1.2"), true);
				assert.equal(range.testVersion("1.5"), true);
				range.combineVersion(new lib.ModVersionEquality(">", "1.2"));
				assert.equal(range.testVersion("1.2"), false);
				assert.equal(range.testVersion("1.5"), true);

				assert.equal(range.valid, true);
				range.combineVersion(new lib.ModVersionEquality(">", "2.5"));
				assert.equal(range.valid, false);
			});
			it("should throw if the equality is invalid (unreachable)", function() {
				const range = new lib.ModVersionRange(
					new lib.ModVersionEquality(">=", "1.0.0"),
					new lib.ModVersionEquality("<", "2.0.0"),
				);
				const version = new lib.ModVersionEquality(">", "1.2");
				version.equality = "==";
				assert.throws(() => range.combineVersion(version));
			});
		});
	});
});
