"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

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
	describe("isTargetVersion", function() {
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
		describe("constructor", function() {
			it("should be constructible", function() {
				const version = new lib.ModVersionEquality("=", 100);
				assert.equal(version.equality, "=");
				assert.equal(version.integerVersion, 100);
			});
		});
		describe("testIntegerVersion()", function() {
			it("should test for less than", function() {
				const version = new lib.ModVersionEquality("<", 100);
				assert.equal(version.testIntegerVersion(90), true);
				assert.equal(version.testIntegerVersion(100), false);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for less than equal", function() {
				const version = new lib.ModVersionEquality("<=", 100);
				assert.equal(version.testIntegerVersion(90), true);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for equal", function() {
				const version = new lib.ModVersionEquality("=", 100);
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), false);
			});
			it("should test for greater than equal", function() {
				const version = new lib.ModVersionEquality(">=", 100);
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), true);
				assert.equal(version.testIntegerVersion(110), true);
			});
			it("should test for greater than", function() {
				const version = new lib.ModVersionEquality(">", 100);
				assert.equal(version.testIntegerVersion(90), false);
				assert.equal(version.testIntegerVersion(100), false);
				assert.equal(version.testIntegerVersion(110), true);
			});
		});
		describe("testVersion()", function() {
			it("should test for less than", function() {
				const version = new lib.ModVersionEquality("<", lib.integerFullVersion("1.1.1"));
				assert.equal(version.testVersion("1.0"), true);
				assert.equal(version.testVersion("1.1"), true);
				assert.equal(version.testVersion("1.1.1"), false);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for less than equal", function() {
				const version = new lib.ModVersionEquality("<=", lib.integerFullVersion("1.1.1"));
				assert.equal(version.testVersion("1.0"), true);
				assert.equal(version.testVersion("1.1"), true);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for equal", function() {
				const version = new lib.ModVersionEquality("=", lib.integerFullVersion("1.1.1"));
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), false);
				assert.equal(version.testVersion("1.2"), false);
			});
			it("should test for greater than equal", function() {
				const version = new lib.ModVersionEquality(">=", lib.integerFullVersion("1.1.1"));
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), true);
				assert.equal(version.testVersion("1.1.2"), true);
				assert.equal(version.testVersion("1.2"), true);
			});
			it("should test for greater than", function() {
				const version = new lib.ModVersionEquality(">", lib.integerFullVersion("1.1.1"));
				assert.equal(version.testVersion("1.0"), false);
				assert.equal(version.testVersion("1.1"), false);
				assert.equal(version.testVersion("1.1.1"), false);
				assert.equal(version.testVersion("1.1.2"), true);
				assert.equal(version.testVersion("1.2"), true);
			});
		});
		describe("fromString()", function() {
			it("should would for all equalities", function() {
				const equalities = ["<", "<=", "=", ">=", ">"];
				for (const eq of equalities) {
					const test = `${eq} 1.0.0`;
					const version = lib.ModVersionEquality.fromString(test);
					assert.equal(version.equality, eq, test);
					assert.equal(version.integerVersion, lib.integerFullVersion("1.0.0"), test);
				}
			});
			it("should would for all version types", function() {
				const versions = ["0.18", "1.0", "1.0.0", "1.1.1"];
				for (const ver of versions) {
					const test = `= ${ver}`;
					const version = lib.ModVersionEquality.fromString(test);
					assert.equal(version.equality, "=", test);
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
			it("should would for all equalities", function() {
				const equalities = ["<", "<=", "=", ">=", ">"];
				for (const eq of equalities) {
					const version = lib.ModVersionEquality.fromParts(eq, "1.0.0");
					assert.equal(version.equality, eq, eq);
					assert.equal(version.integerVersion, lib.integerFullVersion("1.0.0"), eq);
				}
			});
			it("should would for all version types", function() {
				const versions = ["0.18", "1.0", "1.0.0", "1.1.1"];
				for (const ver of versions) {
					const version = lib.ModVersionEquality.fromParts("=", ver);
					assert.equal(version.equality, "=", ver);
					assert.equal(version.integerVersion, lib.integerPartialVersion(ver), ver);
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
});
