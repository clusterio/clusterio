import assert from "node:assert/strict";

import { checkPullRequestBody } from "../scripts/pr_to_changelog.mts";
import { findChangelogProblems } from "../scripts/check_pr_changelog.mts";


describe("scripts/check_pr_changelog", function() {
	function body(...lines) {
		return ["Description.", "", "### Changelog", ...lines].join("\r\n");
	}

	it("accepts entries in a code block", function() {
		const text = body(
			"```",
			"### Features",
			"- Added doodad. #12",
			"",
			"### Fixes",
			"- Fixed [#13](https://github.com/clusterio/clusterio/issues/13)",
			"```",
		);
		assert.deepEqual(findChangelogProblems(text), []);
		assert.deepEqual({ ...checkPullRequestBody(text).changelog }, {
			"Features": ["Added doodad. #12"],
			"Fixes": ["Fixed #13"],
		});
	});
	it("accepts None. in place of the code block", function() {
		assert.deepEqual(findChangelogProblems(body("", "None. Only changes CI.")), []);
	});
	it("rejects a missing body or section", function() {
		assert.deepEqual(findChangelogProblems(null), ["Pull request has no body"]);
		assert.deepEqual(findChangelogProblems("Description only."), ["### Changelog header not found"]);
		assert.deepEqual(findChangelogProblems(body("Text")), ["Code block not found after header"]);
		assert.deepEqual(findChangelogProblems(body("```", "### Fixes")), ["End of code block not found after header"]);
		assert.deepEqual(findChangelogProblems(body("```", "", "```")), [
			"Code block is empty, replace it with None. if nothing applies",
		]);
	});
	it("rejects None. inside the code block", function() {
		assert.deepEqual(findChangelogProblems(body("```", "None.", "```")), [
			"\"None.\" on line 1 must replace the code block, not sit inside it",
		]);
	});
	it("rejects malformed entries", function() {
		const text = body("```", "- Orphan #1", "### Bugs", "- Fixed it", "Loose text", "```");
		assert.deepEqual(findChangelogProblems(text), [
			"Unexpected content \"- Orphan #1\" outside of a changelog section on line 1",
			"Changelog section Bugs on line 2 is not one of " +
				"Major Features, Features, Fixes, Changes, Breaking Changes, Meta",
			"Changelog entry on line 3 does not reference an issue",
			"Unexpected content \"Loose text\" on line 4",
		]);
	});
	it("rejects the unedited template", function() {
		const text = body(
			"```", "### Features", "- Added doodad to web interface. #999", "", "### Changes", "- ...", "```",
		);
		assert.deepEqual(findChangelogProblems(text), ["Changelog entry on line 5 does not reference an issue"]);
	});
});
