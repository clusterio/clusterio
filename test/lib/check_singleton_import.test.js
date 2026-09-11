import assert from "node:assert/strict";
import { checkSingletonImport } from "@clusterio/lib/dist/node/src/check_singleton_import.js";
// Import lib so it sets the global indicating lib has been imported.
import "@clusterio/lib";

describe("lib/check_singleton_import", function() {
	it("Should throw an installation error if called twice", function() {
		assert.throws(
			() => checkSingletonImport(import.meta.filename),
			{
				message: /Attempt to import duplicate copy of @clusterio\/lib/,
				code: "InstallationError",
			}
		);
	});
});
