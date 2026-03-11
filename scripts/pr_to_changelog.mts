import {
	type Release,
	type Issue,
	githubFetchJson,
	githubFetchJsonPaginated,
} from "./github_api.mts";

type Changelog = Record<string, string[]>;

const changelogSections = [
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
		if (pattern.test(parser.lines[parser.pos])) {
			return success;
		}
	}
	return failure;
}

function skipEmptyLines(parser: ParserState) {
	while (parser.pos < parser.lines.length && /^ *$/.test(parser.lines[parser.pos])) {
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
		return [failure, , "Header not found"];
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
	return [success, parser.lines.slice(blockStartPos, parser.pos)];
}

function parseChangelog(parser: ParserState, issues: Issue[]): [Changelog, string[]] {
	let section: string | undefined;
	let changelog: Changelog = Object.create(null);
	let warnings: string[] = [];
	while (!atEnd(parser)) {
		const line = parser.lines[parser.pos];
		parser.pos += 1;
		if (line.trim() === "") {
			continue;
		}
		if (line.startsWith("###")) {
			section = line.slice(4).trim();
			if (!changelogSections.includes(section)) {
				warnings.push(`Unrecognised changelog section ${section} at line ${parser.pos}`);
			}
			changelog[section] = changelog[section] ?? [];
			continue;
		}
		if (!section) {
			warnings.push(`Unexpected content "${line}" outside changelog section at line ${parser.pos}`);
			continue;
		}
		if (line.startsWith("- ")) {
			const entry = line
				.slice(2)
				.trim()
				.replace(/\[#(\d+)\]\(https:\/\/github.com\/clusterio\/clusterio\/(issues|pull)\/\d+\)/g, "#$1");
			let hasRef = false
			for (const ref of entry.matchAll(/#(\d+)/g)) {
				hasRef = true;
				const id = Number.parseInt(ref[1], 10);
				if (!issues.some(issue => issue.number === id)) {
					warnings.push(`Unrecognised issue reference ${ref[0]} at line ${parser.pos}`);
				}
			}
			if (!hasRef) {
				warnings.push(`Changelog entry does not reference an issue line ${parser.pos}`);
			}
			changelog[section].push(entry);
			continue;
		}
		warnings.push(`Unrecognised changelog entry at line ${parser.pos}`);
	}
	return [changelog, warnings];
}

function changelogFromPullRequests(pullRequests: Issue[], issues: Issue[]) {
	const mergedChangelog: Changelog = Object.create(null);
	for (const pr of pullRequests) {
		const [
			changelogFail,
			changelogLines,
			changelogFailReason
		] = extractPullRequestChangelog(createParser(pr.body!.split(/\r?\n/)));
		if (changelogFail) {
			console.error(`Failed to extract changelog in ${pr.html_url}: ${changelogFailReason}`)
			continue;
		}
		const [changelog, warnings] = parseChangelog(createParser(changelogLines), issues);
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
	const releases = await githubFetchJson<Release[]>("/repos/clusterio/clusterio/releases");
	const latest = releases.find(r => r.target_commitish === "master");
	if (!latest) {
		throw new Error("Unable to find latest release on master");
	}
	return latest;
}

async function fetchIssuesUpdatedSince(since: string) {
	return await githubFetchJsonPaginated<Issue>(
		"/repos/clusterio/clusterio/issues",
		{ state: "all", since, sort: "updated", direction: "asc", per_page: "100" },
	);
}

function printMarkdown(changelog: Changelog, issues: Issue[], refText: (issue: Issue) => string) {
	const sections = new Set([...changelogSections, ...Object.keys(changelog)]);
	for (const section of sections) {
		if (section in changelog) {
			console.log(`### ${section}`);
			const entries = changelog[section];
			console.log(entries.map(text => (
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
			)).join("\n"));
			console.log();
		}
	}
}

async function main() {
	const lastRelease = await fetchLastRelease();
	const issues = await fetchIssuesUpdatedSince(lastRelease.created_at);

	const pullRequests = issues.filter(issue => (
		issue.pull_request
		&& issue.pull_request.merged_at
		&& issue.pull_request.merged_at > lastRelease.created_at
	));

	const changelog = changelogFromPullRequests(pullRequests, issues);

	console.log();
	console.log("=== Github markdown ===");
	printMarkdown(changelog, issues, issue => `clusterio/clusterio#${issue.number}`);
	console.log();
	console.log("=== Discord markdown ===");
	printMarkdown(changelog, issues, issue => `[#${issue.number}](<${issue.html_url}>`);
}

if (import.meta.main) {
	main().catch(console.error);
}
