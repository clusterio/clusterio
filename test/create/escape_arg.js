import child_process from "node:child_process";
import util from "node:util";
import assert from "node:assert/strict";
import path from "node:path";

import { escapeArg } from "../../packages/create/escape_arg.js";
const execFile = util.promisify(child_process.execFile);

async function exec(file, args) {
	const command = [file, ...args.map(escapeArg)].join(" ");
	const { stdout, stderr } = await execFile(
		command,
		{ shell: true, cwd: import.meta.dirname, env: { ...process.env, pct: "%"} }
	);
	return { stdout: JSON.parse(stdout), stderr };
}

const strings = [
	'"a"',
	"a sentence of text.",
	" irregular  \tspaces   ",
	'"C:\\path\\"',
	"C:\\path\\",
	'\\ "\\" \\\\ "\\\\" \\\\\\ "\\\\\\" \\\\\\\\ "\\\\\\\\" \\\\\\\\\\ "\\\\\\\\\\" \\\\\\\\\\\ "\\\\\\\\\\\\"',
	'"C:\\path"',
	"C:\\path",
	"%OS%",
	"!OS!",
	"😮",
];
for (let i=1; i < 128; i++) {
	const char = String.fromCodePoint(i);
	// Skip newline and carriage return because those are difficult to escape
	// Skip most alphanumeric characters as they don't behave differently to each other.
	if (/[\n\r1-9B-Zb-z]/.test(char)) {
		continue;
	}
	strings.push(char, `${char}${char}`, `${char}"`);
}

// Test 100 strings at a time.
const tests = [[]];
for (const string of strings) {
	if (tests[tests.length - 1].length >= 100) {
		tests.push([]);
	}
	tests[tests.length - 1].push(string);
}


describe("create/escape_arg", function() {
	it("should correctly escape strings when args are forwarded", async function() {
		const ext = process.platform === "win32" ? ".cmd" : ".sh";
		for (const args of tests) {
			assert.deepEqual(
				await exec(`.${path.sep}forward_args${ext}`, ["echo_args.js", ...args]),
				{ stdout: args, stderr: "" }
			);
		}
	});
	it("should correctly escape strings when invoking node directly", async function() {
		for (const args of tests) {
			assert.deepEqual(
				await exec("node", ["echo_args.js", ...args]),
				{ stdout: args, stderr: "" }
			);
		}
	});
});
