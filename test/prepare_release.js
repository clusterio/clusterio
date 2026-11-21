import assert from "node:assert/strict";

import { addChangelogEntry, setPackageVersion } from "../scripts/prepare_release.mts";


describe("scripts/prepare_release", function() {
	describe("setPackageVersion()", function() {
		it("replaces only the package version", function() {
			const text = (version) => `${JSON.stringify({
				name: "@clusterio/lib",
				version,
				dependencies: { a: "2.1.1" },
			}, null, "\t")}\n`;
			assert.equal(setPackageVersion(text("2.1.1"), "2.2.0"), text("2.2.0"));
		});
		it("throws if there is no version", function() {
			assert.throws(() => setPackageVersion('{\n\t"name": "x"\n}\n', "2.2.0"), /No version field/);
		});
	});

	describe("addChangelogEntry()", function() {
		const changelog = "# Changelog\n\n## Version 2.1.1\n\n### Fixes\n\n- Old fix.\n";

		it("adds the entry above the previous release", function() {
			assert.equal(
				addChangelogEntry(changelog, "2.1.2", "### Fixes\n\n- New fix.\n"),
				"# Changelog\n\n## Version 2.1.2\n\n### Fixes\n\n- New fix.\n\n\n" +
				"## Version 2.1.1\n\n### Fixes\n\n- Old fix.\n",
			);
		});
		it("throws if the version already has an entry", function() {
			assert.throws(() => addChangelogEntry(changelog, "2.1.1", "- Fix."), /already has an entry/);
		});
	});
});
