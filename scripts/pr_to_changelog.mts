import {
	type Comparison,
	type Release,
	type Issue,
	githubFetchJson,
	githubFetchJsonPaginated,
	githubFetchText,
} from "./github_api.mts";

type Changelog = Record<string, string[]>;

type Statistics = {
	commits: number,
	pullRequests: number,
	filesChanged: number,
	lineAdditions: number,
	lineDeletions: number,
};

const repository = "clusterio/clusterio";
const branch = "master";

export const changelogSections = [
	"Major Features",
	"Features",
	"Fixes",
	"Changes",
	"Breaking Changes",
	"Meta",
];

// Generic result codes
const success = 0;
const failure = 1;

type ParserState = {
	pos: number,
	lines: string[],
};

function createParser(lines: string[]): ParserState {
	return { pos: 0, lines };
}

function atEnd(parser: ParserState) {
	return parser.pos >= parser.lines.length;
}

function currentLine(parser: ParserState) {
	if (atEnd(parser)) {
		throw new Error("Attempt to access line past end");
	}
	return parser.lines[parser.pos];
}

function skipToLine(
	parser: ParserState,
	pattern: RegExp
) {
	for (; parser.pos < parser.lines.length; parser.pos++) {
		if (pattern.test(currentLine(parser))) {
			return success;
		}
	}
	return failure;
}

function skipEmptyLines(parser: ParserState) {
	while (parser.pos < parser.lines.length && /^ *$/.test(currentLine(parser))) {
		parser.pos += 1;
	}
}

function extractPullRequestChangelog(
	parser: ParserState,
):
	| [typeof success, string[]]
	| [typeof failure, undefined, string]
{
	const headerFail = skipToLine(parser, /^###? Changelog *$/);
	if (headerFail) {
		return [failure, , "\"### Changelog\" header not found"];
	}
	parser.pos += 1;
	skipEmptyLines(parser);
	if (!atEnd(parser) && /^None/i.test(currentLine(parser))) {
		parser.pos += 1;
		return [success, []];
	}
	const blockStartFail = skipToLine(parser, /```/);
	if (blockStartFail) {
		return [failure, , "Code block not found after header"];
	}
	parser.pos += 1
	const blockStartPos = parser.pos;
	const blockEndFail = skipToLine(parser, /```/);
	if (blockEndFail) {
		return [failure, , "End of code block not found after header"];
	}
	const lines = parser.lines.slice(blockStartPos, parser.pos);
	if (!lines.some(line => line.trim() !== "")) {
		return [failure, , "Code block is empty, replace it with \"None.\" if nothing applies"];
	}
	return [success, lines];
}

/** Pass no issues to skip the checks that need the GitHub API. */
function parseChangelog(
	parser: ParserState,
	pr?: Issue,
	issues?: Issue[],
): [Changelog, string[]] {
	let section: string | undefined;
	let changelog: Changelog = Object.create(null);
	let warnings: string[] = [];
	while (!atEnd(parser)) {
		const line = currentLine(parser);
		parser.pos += 1;
		if (line.trim() === "") {
			continue;
		}
		if (line.startsWith("###")) {
			section = line.slice(4).trim();
			if (!changelogSections.includes(section)) {
				warnings.push(
					`Changelog section ${section} on line ${parser.pos} is not one of ${changelogSections.join(", ")}`
				);
			}
			changelog[section] = changelog[section] ?? [];
			continue;
		}
		if (!section && /^None/i.test(line)) {
			warnings.push(`"${line}" on line ${parser.pos} must replace the code block, not sit inside it`);
			continue;
		}
		if (!section) {
			warnings.push(`Unexpected content "${line}" outside of a changelog section on line ${parser.pos}`);
			continue;
		}
		if (line.startsWith("- ")) {
			const entry = line
				.slice(2)
				.trim()
				.replace(new RegExp(`\\[#(\\d+)\\]\\(https://github.com/${repository}/(issues|pull)/\\d+\\)`, "g"), "#$1");
			let hasRef = false
			for (const ref of entry.matchAll(/#(\d+)/g)) {
				hasRef = true;
				if (!issues || !pr) {
					continue;
				}
				const id = Number.parseInt(ref[1], 10);
				const refIssue = issues.find(issue => issue.number === id);
				if (!refIssue) {
					warnings.push(
						`Issue reference ${ref[0]} on line ${parser.pos} does not exist ` +
						"or has not been updated since the last release"
					);
				} else if (refIssue.pull_request && refIssue.number !== pr.number) {
					warnings.push(
						`Pull request reference ${ref[0]} on line ${parser.pos} is to a ` +
						"different Pull request than this one."
					);
				}
			}
			if (!hasRef) {
				warnings.push(`Changelog entry on line ${parser.pos} does not reference an issue`);
			}
			changelog[section].push(entry);
			continue;
		}
		warnings.push(`Unexpected content "${line}" on line ${parser.pos}`);
	}
	return [changelog, warnings];
}

export function checkPullRequestBody(
	body: string | null | undefined,
	pr?: Issue,
	issues?: Issue[],
): { changelog: Changelog, error?: string, warnings: string[] } {
	if (!body) {
		return { changelog: Object.create(null), error: "Pull request has no body", warnings: [] };
	}
	const [
		changelogFail,
		changelogLines,
		changelogFailReason
	] = extractPullRequestChangelog(createParser(body.split(/\r?\n/)));
	if (changelogFail) {
		return { changelog: Object.create(null), error: changelogFailReason, warnings: [] };
	}
	const [changelog, warnings] = parseChangelog(createParser(changelogLines), pr, issues);
	return { changelog, warnings };
}

function changelogFromPullRequests(pullRequests: Issue[], issues: Issue[]) {
	const mergedChangelog: Changelog = Object.create(null);
	for (const pr of pullRequests) {
		const { changelog, error, warnings } = checkPullRequestBody(pr.body, pr, issues);
		if (error) {
			console.error(`Failed to extract changelog in ${pr.html_url}: ${error}`)
			continue;
		}
		for (const warning of warnings) {
			console.warn(`Warning in changelog for ${pr.html_url}: ${warning}`)
		}
		for (const [section, items] of Object.entries(changelog)) {
			mergedChangelog[section] = [...mergedChangelog[section] ?? [], ...items];
		}
	}
	return mergedChangelog;
}

async function fetchLastRelease() {
	// Assumes releases are ordered by their creation or tag time in descending order.
	const releases = await githubFetchJson<Release[]>(`/repos/${repository}/releases`);
	const latest = releases.find(r => r.target_commitish === branch);
	if (!latest) {
		throw new Error(`Unable to find latest release on ${branch}`);
	}
	return latest;
}

async function fetchIssuesUpdatedSince(since: string) {
	return await githubFetchJsonPaginated<Issue>(
		`/repos/${repository}/issues`,
		{ state: "all", since, sort: "updated", direction: "asc" },
	);
}

async function fetchStatistics(lastRelease: Release, pullRequests: Issue[]): Promise<Statistics> {
	const path = `/repos/${repository}/compare/${lastRelease.tag_name}...${branch}`;
	const comparison = await githubFetchJson<Comparison>(path, { per_page: "1" });
	// The JSON response lists at most 300 files, the diff has all of them.
	const diff = await githubFetchText(path, {}, { headers: { "Accept": "application/vnd.github.diff" } });
	let filesChanged = 0;
	let lineAdditions = 0;
	let lineDeletions = 0;
	let inHunk = false; // Skips the ---/+++ file headers
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			filesChanged += 1;
			inHunk = false;
		} else if (line.startsWith("@@")) {
			inHunk = true;
		} else if (inHunk && line.startsWith("+")) {
			lineAdditions += 1;
		} else if (inHunk && line.startsWith("-")) {
			lineDeletions += 1;
		}
	}
	return {
		commits: comparison.total_commits,
		pullRequests: pullRequests.length,
		filesChanged,
		lineAdditions,
		lineDeletions,
	};
}

function formatMarkdown(
	changelog: Changelog,
	issues: Issue[],
	users: Issue["user"][],
	statistics: Statistics,
	refText: (issue: Issue) => string,
	userText: (user: Issue["user"]) => string,
) {
	const lines: string[] = [];
	const sections = new Set([...changelogSections, ...Object.keys(changelog)]);
	for (const section of sections) {
		if (section in changelog) {
			lines.push(`### ${section}`, "");
			const entries = changelog[section];
			lines.push(...entries.map(text => (
				`- ${text.replaceAll(/#(\d+)/g, (ref, idAsText) => {
					const id = Number.parseInt(idAsText, 10);
					if (!Number.isFinite(id)) {
						return ref;
					}
					const issue = issues.find(issue => issue.number === id);
					if (!issue) {
						return ref;
					}
					return refText(issue);
				})}`
			)));
			lines.push("");
		}
	}

	lines.push("### Contributors", "");
	lines.push("Many thanks to the following for contributing to this release:");
	lines.push(users.map(userText).join(", "));

	const format = (value: number) => value.toLocaleString("en-US");
	lines.push("", "### Statistics", "");
	lines.push([
		`Commits: ${format(statistics.commits)}`,
		`Pull Requests: ${format(statistics.pullRequests)}`,
		`Files Changed: ${format(statistics.filesChanged)}`,
		`Additions: +${format(statistics.lineAdditions)}`,
		`Deletions: -${format(statistics.lineDeletions)}`,
	].join("  "));
	return lines.join("\n");
}

/** Builds the release notes for the changes merged since the last release. */
export async function generateReleaseNotes() {
	const lastRelease = await fetchLastRelease();
	const issues = await fetchIssuesUpdatedSince(lastRelease.created_at);

	const pullRequests = issues.filter(issue => (
		issue.pull_request
		&& issue.pull_request.merged_at
		&& issue.pull_request.merged_at > lastRelease.created_at
	));

	const changelog = changelogFromPullRequests(pullRequests, issues);
	const users = [...new Map(pullRequests.map(issue => [issue.user.login, issue.user])).values()];
	const statistics = await fetchStatistics(lastRelease, pullRequests);

	return {
		github: formatMarkdown(changelog, issues, users, statistics,
			issue => `${repository}#${issue.number}`,
			user => `@${user.login}`,
		),
		changelog: formatMarkdown(changelog, issues, users, statistics,
			issue => `[#${issue.number}](<${issue.html_url}>)`,
			user => `[@${user.login}](<${user.html_url}>)`
		),
	};
}

async function main() {
	const notes = await generateReleaseNotes();

	console.log();
	console.log("=== Github Release Markdown ===");
	console.log(notes.github);

	console.log();
	console.log("=== Discord / Changelog Markdown ===");
	console.log(notes.changelog);
}

if (import.meta.main) {
	main().catch(console.error);
}
