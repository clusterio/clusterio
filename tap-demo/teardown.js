"use strict";
// tap --after module: stops the shared controller booted by boot.js and waits for it to
// actually exit (releasing its ports) before returning, so a subsequent run does not race it.
const fsp = require("node:fs/promises");
const { pidPath } = require("./shared");

async function stop() {
	let pid;
	try {
		pid = Number(await fsp.readFile(pidPath, "utf8"));
	} catch {
		return; // nothing was booted
	}
	if (!Number.isInteger(pid)) {
		return;
	}

	// Only signal a process that is currently alive, to avoid killing an unrelated process if
	// the pid was recycled (a tiny TOCTOU window remains). On POSIX SIGINT shuts the controller
	// down gracefully; on Windows Node has no real signals so this is a forced terminate — CI
	// runs on Linux, where the graceful path is exercised.
	try {
		process.kill(pid, "SIGINT");
	} catch {
		return; // already gone
	}

	const deadline = Date.now() + 15000;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch {
			break; // exited and released its ports
		}
		if (Date.now() > deadline) {
			break;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	console.log(`[--after] stopped shared controller (pid ${pid})`);
}

stop().catch(err => {
	console.error(`[--after] teardown note: ${err.message}`);
});
