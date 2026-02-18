"use strict";
const assert = require("assert").strict;
const { HostDetails } = require("@clusterio/lib");

const { testMatrix, testRoundTripJsonSerialisable } = require("../../common");

describe("lib/data/HostDetails", function () {

	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(HostDetails, testMatrix(
			["1.0.0"], // version (required)
			["TestHost"], // name (required)
			[1], // id (required)
			[true, false], // connected (required)
			[undefined, "10.0.0.1"], // remoteAddress
			[undefined, "203.0.113.1"], // publicAddress
			[undefined, 123456], // tokenValidAfter (sec)
			[undefined, 999999], // updatedAtMs (ms)
			[undefined, true], // isDeleted
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const host = new HostDetails("1.0.0", "TestHost", 1, true);

			assert.equal(host.version, "1.0.0");
			assert.equal(host.name, "TestHost");
			assert.equal(host.id, 1);
			assert.equal(host.connected, true);
			assert.equal(host.remoteAddress, "");
			assert.equal(host.publicAddress, "");
			assert.equal(host.tokenValidAfter, 0);
			assert.equal(host.updatedAtMs, 0);
			assert.equal(host.isDeleted, false);
		});

		it("should accept all constructor parameters", function () {
			const host = new HostDetails(
				"2.0.0", "FullHost", 42, false,
				"10.1.1.1", "198.51.100.5",
				123, 999, true
			);

			assert.equal(host.version, "2.0.0");
			assert.equal(host.name, "FullHost");
			assert.equal(host.id, 42);
			assert.equal(host.connected, false);
			assert.equal(host.remoteAddress, "10.1.1.1");
			assert.equal(host.publicAddress, "198.51.100.5");
			assert.equal(host.tokenValidAfter, 123);
			assert.equal(host.updatedAtMs, 999);
			assert.equal(host.isDeleted, true);
		});
	});

	describe(".toJSON()", function () {
		it("should only include required fields when optional fields are not given", function () {
			const host = new HostDetails("1.0.0", "TestHost", 1, false);

			assert.deepEqual(host.toJSON(), {
				version: "1.0.0",
				name: "TestHost",
				id: 1,
				connected: false,
			});
		});

		it("should include all optional fields when set", function () {
			const host = new HostDetails(
				"2.0.0", "FullHost", 99, true,
				"10.0.0.5", "203.0.113.5",
				500, 1000, true
			);

			assert.deepEqual(host.toJSON(), {
				version: "2.0.0",
				name: "FullHost",
				id: 99,
				connected: true,
				remoteAddress: "10.0.0.5",
				publicAddress: "203.0.113.5",
				tokenValidAfter: 500,
				updatedAtMs: 1000,
				isDeleted: true,
			});
		});

		it("should omit optional fields when equal to defaults", function () {
			const host = new HostDetails(
				"1.0.0", "TestHost", 1,
				true, "", "",
				0, 0, false
			);

			assert.deepEqual(host.toJSON(), {
				version: "1.0.0",
				name: "TestHost",
				id: 1,
				connected: true,
			});
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object", function () {
			const host = HostDetails.fromJSON({
				version: "1.0.0",
				name: "TestHost",
				id: 1,
				connected: true,
			});

			assert.equal(host.version, "1.0.0");
			assert.equal(host.name, "TestHost");
			assert.equal(host.id, 1);
			assert.equal(host.connected, true);
			assert.equal(host.remoteAddress, "");
			assert.equal(host.publicAddress, "");
			assert.equal(host.tokenValidAfter, 0);
			assert.equal(host.updatedAtMs, 0);
			assert.equal(host.isDeleted, false);
		});

		it("should preserve optional fields exactly when provided", function () {
			const host = HostDetails.fromJSON({
				version: "3.0.0",
				name: "RemoteHost",
				id: 7,
				connected: false,
				remoteAddress: "192.168.1.5",
				publicAddress: "198.51.100.10",
				tokenValidAfter: 100,
				updatedAtMs: 2000,
				isDeleted: true,
			});

			assert.equal(host.remoteAddress, "192.168.1.5");
			assert.equal(host.publicAddress, "198.51.100.10");
			assert.equal(host.tokenValidAfter, 100);
			assert.equal(host.updatedAtMs, 2000);
			assert.equal(host.isDeleted, true);
		});
	});
});
