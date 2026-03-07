"use strict";
const assert = require("assert").strict;
const { HostDetails } = require("@clusterio/lib");
const { HostRecord } = require("@clusterio/controller");

const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

describe("controller/HostRecord", function () {
	const samplePlugins = new Map([
		["pluginA", "1.0.0"],
		["pluginB", "2.3.4"],
	]);

	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(HostRecord, testMatrix(
			[1], // id
			["TestHost"], // name
			["1.0.0"], // version
			[samplePlugins, new Map()], // plugins
			[true, false], // connected
			[undefined, "10.0.0.1"], // remoteAddress
			[undefined, "203.0.113.1"], // publicAddress
			[undefined, 123456], // tokenValidAfter
			[undefined, 999999], // updatedAtMs
			[undefined, true], // isDeleted
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const record = new HostRecord(1, "TestHost", "1.0.0", new Map());

			assert.equal(record.id, 1);
			assert.equal(record.name, "TestHost");
			assert.equal(record.version, "1.0.0");
			assert.deepEqual(record.plugins, new Map());
			assert.equal(record.connected, false);
			assert.equal(record.remoteAddress, "");
			assert.equal(record.publicAddress, "");
			assert.equal(record.tokenValidAfter, 0);
			assert.equal(record.updatedAtMs, 0);
			assert.equal(record.isDeleted, false);
		});

		it("should accept all constructor parameters", function () {
			const record = new HostRecord(
				42, "FullHost", "2.0.0", samplePlugins,
				true, "10.1.1.1", "198.51.100.5",
				123, 999, true
			);

			assert.equal(record.id, 42);
			assert.equal(record.name, "FullHost");
			assert.equal(record.version, "2.0.0");
			assert.deepEqual(record.plugins, samplePlugins);
			assert.equal(record.connected, true);
			assert.equal(record.remoteAddress, "10.1.1.1");
			assert.equal(record.publicAddress, "198.51.100.5");
			assert.equal(record.tokenValidAfter, 123);
			assert.equal(record.updatedAtMs, 999);
			assert.equal(record.isDeleted, true);
		});
	});

	describe(".toJSON()", function () {
		it("should only include required fields when optional fields are not given", function () {
			const record = new HostRecord(1, "TestHost", "1.0.0", samplePlugins);

			assert.deepEqual(record.toJSON(), {
				id: 1,
				name: "TestHost",
				version: "1.0.0",
				plugins: Object.fromEntries(samplePlugins),
			});
		});

		it("should include all optional fields when set", function () {
			const record = new HostRecord(
				1, "TestHost", "1.0.0", samplePlugins,
				true, "10.0.0.1", "203.0.113.1",
				100, 500, true
			);

			assert.deepEqual(record.toJSON(), {
				id: 1,
				name: "TestHost",
				version: "1.0.0",
				plugins: Object.fromEntries(samplePlugins),
				connected: true,
				remote_address: "10.0.0.1",
				public_address: "203.0.113.1",
				token_valid_after: 100,
				updated_at_ms: 500,
				is_deleted: true,
			});
		});

		it("should omit optional fields when equal to defaults", function () {
			const record = new HostRecord(
				1, "TestHost", "1.0.0", samplePlugins,
				false, "", "",
				0, 0, false
			);

			assert.deepEqual(record.toJSON(), {
				id: 1,
				name: "TestHost",
				version: "1.0.0",
				plugins: Object.fromEntries(samplePlugins),
			});
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object", function () {
			const record = HostRecord.fromJSON({
				id: 7,
				name: "JSONHost",
				version: "1.1.0",
				plugins: { pluginX: "0.1.0" },
			});

			assert.equal(record.id, 7);
			assert.equal(record.name, "JSONHost");
			assert.equal(record.version, "1.1.0");
			assert.deepEqual(record.plugins, new Map([["pluginX", "0.1.0"]]));
			assert.equal(record.connected, false);
			assert.equal(record.remoteAddress, "");
			assert.equal(record.publicAddress, "");
			assert.equal(record.tokenValidAfter, 0);
			assert.equal(record.updatedAtMs, 0);
			assert.equal(record.isDeleted, false);
		});

		it("should preserve optional fields exactly when provided", function () {
			const record = HostRecord.fromJSON({
				id: 7,
				name: "JSONHost",
				version: "1.1.0",
				plugins: { pluginX: "0.1.0" },
				connected: true,
				remote_address: "10.1.1.1",
				public_address: "198.51.100.10",
				token_valid_after: 200,
				updated_at_ms: 1000,
				is_deleted: true,
			});

			assert.equal(record.id, 7);
			assert.equal(record.name, "JSONHost");
			assert.equal(record.version, "1.1.0");
			assert.deepEqual(record.plugins, new Map([["pluginX", "0.1.0"]]));
			assert.equal(record.connected, true);
			assert.equal(record.remoteAddress, "10.1.1.1");
			assert.equal(record.publicAddress, "198.51.100.10");
			assert.equal(record.tokenValidAfter, 200);
			assert.equal(record.updatedAtMs, 1000);
			assert.equal(record.isDeleted, true);
		});
	});

	describe(".toHostDetails()", function () {
		it("should convert HostRecord to HostDetails correctly", function () {
			const record = new HostRecord(
				1, "TestHost", "1.0.0", samplePlugins,
				true, "10.0.0.1", "203.0.113.1",
				123, 456, true
			);

			const details = record.toHostDetails();

			assert(details instanceof HostDetails);
			assert.equal(details.version, record.version);
			assert.equal(details.name, record.name);
			assert.equal(details.id, record.id);
			assert.equal(details.connected, record.connected);
			assert.equal(details.remoteAddress, record.remoteAddress);
			assert.equal(details.publicAddress, record.publicAddress);
			assert.equal(details.tokenValidAfter, record.tokenValidAfter);
			assert.equal(details.updatedAtMs, record.updatedAtMs);
			assert.equal(details.isDeleted, record.isDeleted);
		});
	});

	describe("static fromHostDetails()", function () {
		it("should create HostRecord from HostDetails", function () {
			const details = new HostDetails("1.0.0", "TestHost", 1, true);

			const record = HostRecord.fromHostDetails(details, samplePlugins);

			assert(record instanceof HostRecord);
			assert.equal(record.id, details.id);
			assert.equal(record.name, details.name);
			assert.equal(record.version, details.version);
			assert.deepEqual(record.plugins, samplePlugins);
			assert.equal(record.connected, details.connected);
			assert.equal(record.remoteAddress, details.remoteAddress);
			assert.equal(record.publicAddress, details.publicAddress);
			assert.equal(record.tokenValidAfter, details.tokenValidAfter);
			assert.equal(record.updatedAtMs, details.updatedAtMs);
			assert.equal(record.isDeleted, details.isDeleted);
		});
	});
});
