"use strict";
const child_process = require("child_process");
const util = require("util");
const assert = require("assert").strict;
const path = require("path");

const { escapeArg } = require("../../packages/create/escape_arg");
const execFile = util.promisify(child_process.execFile);

async function exec(file, args) {
	const { stdout, stderr } = await execFile(
		file,
		args.map(escapeArg),
		// eslint-disable-next-line node/no-process-env
		{ shell: true, cwd: __dirname, env: { ...process.env, pct: "%"} }
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
