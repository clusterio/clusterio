"use strict";
const assert = require("assert");
const lib = require("@clusterio/lib");

describe("lib/wube", function() {
	/**
	 * Get available versions of factorio from factorio.com.
	 * @returns {Promise<Array<string>} List of available versions.
	 */
	describe("getAvailableVersions", function() {
		it("should return a list of available versions", async function() {
			let versions = await lib.getAvailableVersions();
			assert(versions.length > 0);
			assert(versions.every(version => typeof version.version === "string"));
			assert(versions.every(version => typeof version.download_url === "object"));
			assert(versions.every(version => typeof version.download_url.linux64 === "string"));
		});
	});
});
