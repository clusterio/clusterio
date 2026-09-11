"use strict";
// tap --before module: boots a real clusterio controller ONCE for the whole tap run,
// leaves it running for the (isolated, per-file) test subprocesses, and records its pid
// so teardown.js can stop it. Intentionally mirrors a minimal slice of
// test/integration/index.js's root before() (see TEST_REFACTOR_PLAN.md).
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const cp = require("node:child_process");
const { promisify } = require("node:util");
const { workDir, logPath, pidPath, authSecret, httpPort, httpsPort } = require("./shared");

const execAsync = promisify(cp.exec);

function ctl(args) {
	return execAsync(`node --enable-source-maps ../../packages/controller ${args}`, {
		cwd: workDir, env: { ...process.env },
	});
}

async function readStalePid() {
	try {
		return Number(await fsp.readFile(pidPath, "utf8"));
	} catch {
		return null;
	}
}

// Kill a process by pid (if alive) and wait until it has actually exited and released its
// ports. Best-effort: a tiny PID-reuse window remains, acceptable for a test harness.
async function reap(pid, timeoutMs) {
	if (!Number.isInteger(pid)) {
		return;
	}
	try {
		process.kill(pid, "SIGINT");
	} catch {
		return; // already gone
	}
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch {
			return; // exited
		}
		if (Date.now() > deadline) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// already gone
			}
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
}

async function main() {
	// Reap a controller orphaned by a previous aborted run BEFORE wiping the dir — otherwise
	// its pidfile is deleted and it can never be found again while it still holds the ports.
	await reap(await readStalePid(), 10000);

	await fsp.rm(workDir, { force: true, recursive: true, maxRetries: 10 });
	await fsp.mkdir(workDir, { recursive: true });

	// minimal controller config (mirrors test/integration/index.js)
	await ctl(`config set controller.auth_secret ${authSecret}`);
	await ctl(`config set controller.http_port ${httpPort}`);
	await ctl(`config set controller.https_port ${httpsPort}`);
	await ctl("config set controller.tls_certificate ../../test/file/tls/cert.pem");
	await ctl("config set controller.tls_private_key ../../test/file/tls/key.pem");
	await ctl("bootstrap create-admin test");

	// spawn the controller detached, logging to a file so it survives this short-lived process
	const logFd = fs.openSync(logPath, "a");
	let child;
	try {
		child = cp.spawn("node", ["--enable-source-maps", "../../packages/controller", "run"], {
			cwd: workDir, env: { ...process.env }, detached: true, stdio: ["ignore", logFd, logFd],
		});
	} finally {
		fs.closeSync(logFd); // the child kept its own dup; the parent's copy must not leak
	}
	await fsp.writeFile(pidPath, String(child.pid));
	child.unref();

	try {
		const deadline = Date.now() + 30000;
		for (;;) {
			let content = "";
			try {
				content = await fsp.readFile(logPath, "utf8");
			} catch {
				content = ""; // log not written yet
			}
			if (/Started controller/.test(content)) {
				break;
			}
			try {
				process.kill(child.pid, 0);
			} catch {
				throw new Error(`controller exited early:\n${content}`);
			}
			if (Date.now() > deadline) {
				throw new Error(`timed out waiting for controller:\n${content}`);
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	} catch (err) {
		try {
			child.kill("SIGINT"); // do not leave the controller orphaned on a failed boot
		} catch {
			// already gone
		}
		throw err;
	}

	console.log(`[--before] shared controller booted ONCE (pid ${child.pid})`);
}

// No process.exit(): let the loop drain so the final log line flushes, and signal failure via
// the exit code instead (process.exit can truncate buffered stdout on a pipe).
main().catch(err => {
	process.exitCode = 1;
	console.error(`[--before] boot failed: ${err.message}`);
});
