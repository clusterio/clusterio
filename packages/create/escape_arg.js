"use strict";

function escapeArg(arg) {
	// When shell: true is used execFile does not escaping of arguments, they are
	// simply joined by space and then passed to the shell.

	// For Windows the command is cmd.exe /d /s /c "command arg arg ..."
	// The parsing and escaping on windows is cursed. The following references are not for mortals:
	// https://daviddeley.com/autohotkey/parameters/parameters.htm#WIN
	// https://stackoverflow.com/a/4095133
	// https://ss64.com/nt/syntax-esc.html
	if (process.platform === "win32") {
		if (!/[\t "%&<>\\^|]/.test(arg)) {
			return arg;
		}

		const escaped = [];
		let pos = 0;
		while (pos < arg.length) {
			if (arg[pos] === "\\") {
				// If a backslash is followed by a quote or the end of the string, then
				// double the number of backslashes because why not!
				let peek = pos + 1;
				while (peek !== arg.length && arg[peek] === "\\") {
					peek += 1;
				}
				if (peek === arg.length || arg[peek] === '"') {
					const count = peek - pos;
					escaped.push("\\".repeat(count * 2));
					pos = peek;
					continue;
				} else {
					escaped.push("\\");
				}
			} else if (arg[pos] === '"') {
				escaped.push('""');
			} else if (arg[pos] === "%") {
				// Expect a pct environment variable to contain %, because cmd does variable substitutions
				// before parsing string quotes, and there's no mechanism for escaping % symbols, and this
				// is a half sane workaround. The less sane workaround is to replace % with %%cd:~,%.
				escaped.push("%pct%");
			} else {
				escaped.push(arg[pos]);
			}
			pos += 1;
		}
		return `"${escaped.join("")}"`;
	}

	// For all other platforms the command is /bin/sh -c <command arg arg ...>
	// The command and its arguments are passed as a single argument to the shell.
	// See https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_02

	if (!/[|&;<>()$`\\"' \t*?\[#~=%]/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/[$`"\\]/g, "\\$&")}"`;
}

module.exports = {
	escapeArg,
};
