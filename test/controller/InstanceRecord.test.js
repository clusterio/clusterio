"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { InstanceRecord } = require("@clusterio/controller");

const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

describe("controller/InstanceRecord", function () {
	/** @type {lib.InstanceConfig} */
	let defaultConfig;

	before(function() {
		// This is needed to pick up any plugins that are loaded
		defaultConfig = new lib.InstanceConfig("controller", {
			"instance.id": 1,
			"instance.name": "TestInstance",
			"instance.assigned_host": 1,
			"instance.exclude_from_start_all": false,
		});
	});

	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(InstanceRecord, testMatrix(
			[defaultConfig], // config
			["running", "stopped"], // status
			[undefined, 34197], // gamePort
			[undefined, "1.0.0"], // factorioVersion
			[undefined, 1234], // startedAtMs
			[undefined, 5678], // updatedAtMs
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const record = new InstanceRecord(defaultConfig, "running");

			assert.equal(record.config, defaultConfig);
			assert.equal(record.status, "running");
			assert.equal(record.gamePort, undefined);
			assert.equal(record.factorioVersion, undefined);
			assert.equal(record.startedAtMs, 0);
			assert.equal(record.updatedAtMs, 0);
		});

		it("should accept all constructor parameters", function () {
			const record = new InstanceRecord(
				defaultConfig, "starting",
				34197, "1.0.0",
				100, 200
			);

			assert.equal(record.status, "starting");
			assert.equal(record.gamePort, 34197);
			assert.equal(record.factorioVersion, "1.0.0");
			assert.equal(record.startedAtMs, 100);
			assert.equal(record.updatedAtMs, 200);
		});
	});

	describe(".toJSON()", function () {
		it("should include required fields when optional fields are not given", function () {
			const record = new InstanceRecord(defaultConfig, "running");

			assert.deepEqual(record.toJSON(), {
				config: defaultConfig.toJSON(),
				status: "running",
			});
		});

		it("should include optional fields when non-default", function () {
			const record = new InstanceRecord(
				defaultConfig, "running",
				34197, "1.0.0",
				100, 200
			);

			assert.deepEqual(record.toJSON(), {
				config: defaultConfig.toJSON(),
				status: "running",
				gamePort: 34197,
				factorioVersion: "1.0.0",
				startedAtMs: 100,
				updatedAtMs: 200,
			});
		});

		it("should omit optional fields when equal to defaults", function () {
			const record = new InstanceRecord(
				defaultConfig, "running",
				undefined, undefined,
				undefined, undefined
			);

			assert.deepEqual(record.toJSON(), {
				config: defaultConfig.toJSON(),
				status: "running",
			});
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object", function () {
			const json = {
				config: defaultConfig.toJSON(),
				status: "stopped",
			};

			const record = InstanceRecord.fromJSON(json);

			assert.equal(record.status, "stopped");
			assert.equal(record.gamePort, undefined);
			assert.equal(record.factorioVersion, undefined);
			assert.equal(record.startedAtMs, 0);
			assert.equal(record.updatedAtMs, 0);
		});

		it("should preserve optional fields exactly when provided", function () {
			const json = {
				config: defaultConfig.toJSON(),
				status: "stopped",
				gamePort: 34197,
				factorioVersion: "1.0.0",
				startedAtMs: 100,
				updatedAtMs: 200,
			};

			const record = InstanceRecord.fromJSON(json);

			assert.equal(record.status, "stopped");
			assert.equal(record.gamePort, 34197);
			assert.equal(record.factorioVersion, "1.0.0");
			assert.equal(record.startedAtMs, 100);
			assert.equal(record.updatedAtMs, 200);
		});
	});

	describe("toInstanceDetails()", function () {
		it("should convert InstanceRecord to lib.InstanceDetails correctly", function () {
			const record = new InstanceRecord(
				defaultConfig, "running",
				34197, "1.0.0",
				100, 200
			);

			const details = record.toInstanceDetails();

			assert(details instanceof lib.InstanceDetails);
			assert.equal(details.name, record.config.get("instance.name"));
			assert.equal(details.id, record.id);
			assert.equal(details.assignedHost, 1);
			assert.equal(details.gamePort, 34197);
			assert.equal(details.status, "running");
			assert.equal(details.factorioVersion, "1.0.0");
			assert.equal(details.startedAtMs, 100);
			assert.equal(details.updatedAtMs, 200);
			assert.equal(details.excludeFromStartAll, false);
		});
	});

	describe("static fromInstanceDetails()", function () {
		it("should create InstanceRecord from lib.InstanceDetails", function () {
			const details = new lib.InstanceDetails(
				"TestInstance", 1, 1, 34197,
				"running", "1.0.0",
				100, 200, false
			);

			const record = InstanceRecord.fromInstanceDetails(details, defaultConfig);

			assert(record instanceof InstanceRecord);
			assert.equal(record.status, "running");
			assert.equal(record.gamePort, 34197);
			assert.equal(record.factorioVersion, "1.0.0");
			assert.equal(record.startedAtMs, 100);
			assert.equal(record.updatedAtMs, 200);
		});
	});

	describe("get/set .isDeleted", function () {
		it("should return true if status is deleted", function () {
			const record = new InstanceRecord(defaultConfig, "deleted");
			assert.equal(record.isDeleted, true);
		});

		it("should throw if trying to set isDeleted to false", function () {
			const record = new InstanceRecord(defaultConfig, "running");
			assert.throws(() => { record.isDeleted = false; }, /Setting isDeleted to false is not supported/);
		});

		it("should set status to deleted when isDeleted = true", function () {
			const record = new InstanceRecord(defaultConfig, "running");
			record.isDeleted = true;
			assert.equal(record.status, "deleted");
			assert.equal(record.isDeleted, true);
		});
	});
});
