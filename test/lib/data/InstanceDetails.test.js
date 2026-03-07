"use strict";
const assert = require("assert").strict;
const { InstanceDetails } = require("@clusterio/lib");

const { testMatrix, testRoundTripJsonSerialisable } = require("../../common");

describe("lib/data/InstanceDetails", function () {

	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(InstanceDetails, testMatrix(
			["TestInstance"], // name (required)
			[1], // id (required)
			[undefined, 5], // assignedHost
			[undefined, 34197], // gamePort
			["running", "stopped"], // status (required)
			[undefined, "1.0.0"], // factorioVersion
			[undefined, 1234], // startedAtMs
			[undefined, 9999], // updatedAtMs
			[undefined, true], // excludeFromStartAll
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const instance = new InstanceDetails("TestInstance", 1, undefined, undefined, "running");

			assert.equal(instance.name, "TestInstance");
			assert.equal(instance.id, 1);
			assert.equal(instance.assignedHost, undefined);
			assert.equal(instance.gamePort, undefined);
			assert.equal(instance.status, "running");
			assert.equal(instance.factorioVersion, undefined);
			assert.equal(instance.startedAtMs, 0);
			assert.equal(instance.updatedAtMs, 0);
			assert.equal(instance.excludeFromStartAll, false);
		});

		it("should accept all constructor parameters", function () {
			const instance = new InstanceDetails(
				"FullInstance", 42, 10, 34197,
				"starting", "1.0.0", 1000, 2000, true
			);

			assert.equal(instance.name, "FullInstance");
			assert.equal(instance.id, 42);
			assert.equal(instance.assignedHost, 10);
			assert.equal(instance.gamePort, 34197);
			assert.equal(instance.status, "starting");
			assert.equal(instance.factorioVersion, "1.0.0");
			assert.equal(instance.startedAtMs, 1000);
			assert.equal(instance.updatedAtMs, 2000);
			assert.equal(instance.excludeFromStartAll, true);
		});
	});

	describe(".toJSON()", function () {
		it("should only include required fields when optional fields are not given", function () {
			const instance = new InstanceDetails("TestInstance", 1, undefined, undefined, "running");

			assert.deepEqual(instance.toJSON(), {
				name: "TestInstance",
				id: 1,
				status: "running",
			});
		});

		it("should include all optional fields when set", function () {
			const instance = new InstanceDetails(
				"FullInstance", 99, 5, 34197,
				"running", "1.0.0", 500, 1000, true
			);

			assert.deepEqual(instance.toJSON(), {
				name: "FullInstance",
				id: 99,
				status: "running",
				assignedHost: 5,
				gamePort: 34197,
				factorioVersion: "1.0.0",
				startedAtMs: 500,
				updatedAtMs: 1000,
				excludeFromStartAll: true,
			});
		});

		it("should omit optional fields when equal to defaults", function () {
			const instance = new InstanceDetails(
				"TestInstance", 1, undefined, undefined,
				"stopped", undefined, 0, 0, false
			);

			assert.deepEqual(instance.toJSON(), {
				name: "TestInstance",
				id: 1,
				status: "stopped",
			});
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object and apply constructor defaults", function () {
			const instance = InstanceDetails.fromJSON({
				name: "TestInstance",
				id: 1,
				status: "running",
			});

			assert.equal(instance.name, "TestInstance");
			assert.equal(instance.id, 1);
			assert.equal(instance.assignedHost, undefined);
			assert.equal(instance.gamePort, undefined);
			assert.equal(instance.factorioVersion, undefined);
			assert.equal(instance.startedAtMs, 0);
			assert.equal(instance.updatedAtMs, 0);
			assert.equal(instance.excludeFromStartAll, false);
		});

		it("should preserve optional fields exactly when provided", function () {
			const instance = InstanceDetails.fromJSON({
				name: "RemoteInstance",
				id: 7,
				status: "starting",
				assignedHost: 2,
				gamePort: 34197,
				factorioVersion: "1.0.0",
				startedAtMs: 100,
				updatedAtMs: 200,
				excludeFromStartAll: true,
			});

			assert.equal(instance.assignedHost, 2);
			assert.equal(instance.gamePort, 34197);
			assert.equal(instance.factorioVersion, "1.0.0");
			assert.equal(instance.startedAtMs, 100);
			assert.equal(instance.updatedAtMs, 200);
			assert.equal(instance.excludeFromStartAll, true);
		});
	});

	describe("get .isDeleted", function () {
		it("should return true when status is 'deleted'", function () {
			const instance = new InstanceDetails("TestInstance", 1, undefined, undefined, "deleted");

			assert.equal(instance.isDeleted, true);
		});

		it("should return false when status is not 'deleted'", function () {
			const instance = new InstanceDetails("TestInstance", 1, undefined, undefined, "running");

			assert.equal(instance.isDeleted, false);
		});
	});
});
