"use strict";
const assert = require("assert").strict;
const { UserDetails, PlayerStats } = require("@clusterio/lib");
const { UserRecord } = require("@clusterio/controller");

const { testMatrix, testRoundTripJsonSerialisable } = require("../common");

describe("controller/UserRecord", function () {
	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(UserRecord, testMatrix(
			[0, 50], // tokenValidAfter
			["TestUser"], // name
		));
	});

	describe("constructor", function () {
		it("should default tokenValidAfter to 0", function () {
			const user = new UserRecord(undefined, "TestUser");
			assert.equal(user.tokenValidAfter, 0);
		});

		it("should set tokenValidAfter when provided", function () {
			const user = new UserRecord(123, "TestUser");
			assert.equal(user.tokenValidAfter, 123);
		});
	});

	describe("static fromJSON()", function () {
		it("should construct from JSON without token_valid_after", function () {
			const json = {
				name: "TestUser",
			};

			const user = UserRecord.fromJSON(json);
			assert.equal(user.tokenValidAfter, 0);
			assert.equal(user.name, "TestUser");
		});

		it("should construct from JSON with token_valid_after", function () {
			const json = {
				name: "TestUser",
				token_valid_after: 99,
			};

			const user = UserRecord.fromJSON(json);
			assert.equal(user.tokenValidAfter, 99);
		});
	});

	describe(".toJSON()", function () {
		it("should omit token_valid_after when 0", function () {
			const user = new UserRecord(0, "TestUser");

			const json = user.toJSON();
			assert.equal(json.token_valid_after, undefined);
		});

		it("should include token_valid_after when > 0", function () {
			const user = new UserRecord(42, "TestUser");

			const json = user.toJSON();
			assert.equal(json.token_valid_after, 42);
		});
	});

	describe("static fromUserDetails()", function () {
		it("should copy all fields from UserDetails", function () {
			const details = new UserDetails(
				"TestUser", new Set([1]), new Set([2]),
				true, true, false, "reason",
				100, false,
				new Map()
			);

			const record = UserRecord.fromUserDetails(details, 55);

			assert.equal(record.name, details.name);
			assert.deepEqual(record.roleIds, details.roleIds);
			assert.deepEqual(record.instances, details.instances);
			assert.equal(record.isAdmin, details.isAdmin);
			assert.equal(record.tokenValidAfter, 55);
		});
	});

	describe(".toUserDetails()", function () {
		it("should create equivalent UserDetails without tokenValidAfter", function () {
			const record = new UserRecord(10, "TestUser");
			const details = record.toUserDetails();

			assert(details instanceof UserDetails);
			assert.equal(details.name, record.name);
			assert.equal(details.tokenValidAfter, undefined);
		});
	});

	describe("merge", function () {
		it("should throw if ids do not match", function () {
			const a = new UserRecord(0, "UserA");
			const b = new UserDetails("UserB");

			assert.throws(() => a.merge(b), /different ids/);
		});

		it("should merge sets and boolean flags", function () {
			const a = new UserRecord(
				0, "TestUser", new Set([1]), new Set([10]),
				true, false, false, "old",
				100, false
			);

			const b = new UserDetails(
				"TestUser", new Set([2]), new Set([20]),
				false, true, true, "new",
				200, false
			);

			const beforeUpdated = a.updatedAtMs;

			a.merge(b);

			assert.deepEqual(a.roleIds, new Set([1, 2])); // roleIds union
			assert.deepEqual(a.instances, new Set([10, 20])); // instances union
			assert.equal(a.isAdmin, false); // isAdmin uses &&
			assert.equal(a.isBanned, true); // isBanned uses ||
			assert.equal(a.isWhitelisted, true); // isWhitelisted uses ||
			assert.equal(a.banReason, "new"); // banReason chosen by updatedAtMs comparison
			assert(a.updatedAtMs > beforeUpdated); // updatedAtMs changed
		});

		it("should merge instanceStats entries", function () {
			const a = UserRecord.fromJSON({ name: "TestUser", instance_stats: [
				[1, { join_count: 1 }],
			]});

			const b = UserRecord.fromJSON({ name: "TestUser", instance_stats: [
				[1, { join_count: 3 }], // merge existing
				[2, { join_count: 5 }], // add new
			]});

			a.merge(b);

			assert.equal(a.instanceStats.has(1), true);
			assert.equal(a.instanceStats.get(1).joinCount, 4);
			assert.equal(a.instanceStats.has(2), true);
			assert.equal(a.instanceStats.get(2).joinCount, 5);
		});
	});
});
