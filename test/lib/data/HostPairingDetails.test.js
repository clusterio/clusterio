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
});
