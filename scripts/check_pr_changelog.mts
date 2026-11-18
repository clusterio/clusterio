// Checks the changelog section of a pull request body, read from the PR_BODY environment variable.
import fs from "node:fs";
import { checkPullRequestBody, changelogSections } from "./pr_to_changelog.mts";

const expectedFormat = [
	"### Changelog",
	"```",
	"### Features",
	"- Added doodad to web interface. #123",
	"",
	"### Fixes",
	"- Fixed doodad not showing up. #456",
	"```",
	"",
	"Or, when nothing user facing changed, replace the code block with:",
	"",
	"### Changelog",
	"None. Reason no change log is required.",
].join("\n");

/** Returns the problems found in the body, an empty list means it is valid. */
export function findChangelogProblems(body: string | null | undefined) {
	const { error, warnings } = checkPullRequestBody(body);
	return error ? [error] : warnings;
}

function escapeAnnotation(text: string) {
	return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function main() {
	const problems = findChangelogProblems(process.env.PR_BODY);
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!problems.length) {
		console.log("Changelog section is valid.");
		if (summaryPath) {
			fs.appendFileSync(summaryPath, "Changelog section is valid.\n");
		}
		return;
	}

	for (const problem of problems) {
		console.log(`::error title=Invalid changelog::${escapeAnnotation(problem)}`);
	}
	const rules = `Valid sections are ${changelogSections.join(", ")}. ` +
		"Each entry must reference an issue, or this pull request if there is no issue.";
	console.log(`\n${rules}`);
	console.log(`Expected format in the pull request description:\n\n${expectedFormat}`);
	if (summaryPath) {
		fs.appendFileSync(summaryPath, [
			"## Invalid changelog",
			"",
			"The changelog section of the pull request description has problems:",
			"",
			...problems.map(problem => `- ${problem.replaceAll("<", "&lt;")}`),
			"",
			rules,
			"Edit the description and this check runs again. Expected format:",
			"",
			"````markdown",
			expectedFormat,
			"````",
			"",
		].join("\n"));
	}
	process.exitCode = 1;
}

if (import.meta.main) {
	main();
}
