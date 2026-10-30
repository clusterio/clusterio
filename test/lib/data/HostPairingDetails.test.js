import assert from "node:assert/strict";
import { HostPairingDetails } from "@clusterio/lib";

import { testMatrix, testRoundTripJsonSerialisable } from "../../common.js";

describe("lib/data/HostPairingDetails", function () {

	it("should be round trip serialisable", function () {
		testRoundTripJsonSerialisable(HostPairingDetails, testMatrix(
			["ABC-DEF"], // code (required)
			["New Host", ""], // name (required)
			["10.0.0.1", "2001:db8::1"], // remoteAddress (required)
			[undefined, "2.0.0"], // version
			[undefined, 123456], // createdAtMs
			[undefined, 999999], // updatedAtMs
			[undefined, true], // isDeleted
		));
	});

	describe("constructor", function () {
		it("should set defaults correctly", function () {
			const details = new HostPairingDetails("ABC-DEF", "New Host", "10.0.0.1");

			assert.equal(details.code, "ABC-DEF");
			assert.equal(details.name, "New Host");
			assert.equal(details.remoteAddress, "10.0.0.1");
			assert.equal(details.version, "");
			assert.equal(details.createdAtMs, 0);
			assert.equal(details.updatedAtMs, 0);
			assert.equal(details.isDeleted, false);
		});

		it("should use the code as the id", function () {
			const details = new HostPairingDetails("ABC-DEF", "New Host", "10.0.0.1");
			assert.equal(details.id, "ABC-DEF");
		});
	});

	describe(".toJSON()", function () {
		it("should only include required fields when optional fields are defaults", function () {
			const details = new HostPairingDetails("ABC-DEF", "New Host", "10.0.0.1", "", 0, 0, false);

			assert.deepEqual(details.toJSON(), {
				code: "ABC-DEF",
				name: "New Host",
				remoteAddress: "10.0.0.1",
			});
		});

		it("should include all optional fields when set", function () {
			const details = new HostPairingDetails("ABC-DEF", "New Host", "10.0.0.1", "2.0.0", 100, 200, true);

			assert.deepEqual(details.toJSON(), {
				code: "ABC-DEF",
				name: "New Host",
				remoteAddress: "10.0.0.1",
				version: "2.0.0",
				createdAtMs: 100,
				updatedAtMs: 200,
				isDeleted: true,
			});
		});

		it("should not include the id getter", function () {
			const details = new HostPairingDetails("ABC-DEF", "New Host", "10.0.0.1");
			assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(details)), "id"), false);
		});
	});

	describe("static fromJSON()", function () {
		it("should construct minimal object", function () {
			const details = HostPairingDetails.fromJSON({
				code: "ABC-DEF",
				name: "New Host",
				remoteAddress: "10.0.0.1",
			});

			assert.equal(details.code, "ABC-DEF");
			assert.equal(details.version, "");
			assert.equal(details.createdAtMs, 0);
			assert.equal(details.updatedAtMs, 0);
			assert.equal(details.isDeleted, false);
		});
	});
});
