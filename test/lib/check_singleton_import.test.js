const assert = require("assert").strict;
const { checkSingletonImport } = require("@clusterio/lib/dist/node/src/check_singleton_import");
// Import lib so it sets the global indicating lib has been imported.
require("@clusterio/lib");

describe("lib/check_singleton_import", function() {
	it("Should throw an installation error if called twice", function() {
		assert.throws(
			() => checkSingletonImport(__filename),
			{
				message: /Attempt to import duplicate copy of @clusterio\/lib/,
				code: "InstallationError",
			}
		);
	});
});
