// Bumps the package versions, adds the release notes to CHANGELOG.md, then commits and tags the release.
// Usage: node scripts/prepare_release.mts <version>
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { generateReleaseNotes } from "./pr_to_changelog.mts";

const root = path.resolve(import.meta.dirname, "..");
const versionPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

async function git(...args: string[]) {
	return (await promisify(execFile)("git", args, { cwd: root, encoding: "utf8" })).stdout;
}

export function setPackageVersion(text: string, version: string) {
	const pattern = /^([ \t]*"version":[ \t]*)"[^"]*"/m;
	if (!pattern.test(text)) {
		throw new Error("No version field found");
	}
	return text.replace(pattern, `$1"${version}"`);
}

export function addChangelogEntry(text: string, version: string, notes: string) {
	if (new RegExp(`^## Version ${version.replaceAll(".", "\\.")}$`, "m").test(text)) {
		throw new Error(`CHANGELOG.md already has an entry for ${version}`);
	}
	const firstEntry = text.search(/^## /m);
	if (firstEntry === -1) {
		throw new Error("No existing entry found in CHANGELOG.md");
	}
	return `${text.slice(0, firstEntry)}## Version ${version}\n\n${notes.trim()}\n\n\n${text.slice(firstEntry)}`;
}

async function packageFiles() {
	const files: string[] = [];
	for (const parent of ["packages", "plugins"]) {
		for (const entry of await fs.readdir(path.join(root, parent), { withFileTypes: true })) {
			const file = path.join(parent, entry.name, "package.json");
			if (entry.isDirectory() && await fs.stat(path.join(root, file)).catch(() => null)) {
				files.push(file);
			}
		}
	}
	return files;
}

async function main() {
	const version = process.argv[2];
	if (!version || !versionPattern.test(version)) {
		console.error("Usage: node scripts/prepare_release.mts <version>, e.g. 2.1.2");
		process.exitCode = 1;
		return;
	}
	if (await git("status", "--porcelain", "--untracked-files=no")) {
		throw new Error("Working tree has uncommitted changes");
	}
	if (await git("tag", "--list", `v${version}`)) {
		throw new Error(`Tag v${version} already exists`);
	}

	// Done first so a GitHub API failure leaves the working tree untouched.
	const notes = await generateReleaseNotes();
	const changelogPath = path.join(root, "CHANGELOG.md");
	const changelog = addChangelogEntry(await fs.readFile(changelogPath, "utf8"), version, notes.changelog);

	const files = await packageFiles();
	for (const file of files) {
		const filePath = path.join(root, file);
		await fs.writeFile(filePath, setPackageVersion(await fs.readFile(filePath, "utf8"), version));
	}
	await fs.writeFile(changelogPath, changelog);

	await git("add", "CHANGELOG.md", ...files);
	await git("commit", "--quiet", "-m", `Prepare ${version}`);
	await git("tag", `v${version}`);

	console.log();
	console.log(`Committed "Prepare ${version}" and tagged it v${version}. Nothing was pushed.`);
	console.log("Review it with: git show --stat HEAD");
	console.log();
	console.log("=== Github Release Markdown ===");
	console.log(notes.github);
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err.message ?? err);
		process.exitCode = 1;
	});
}
