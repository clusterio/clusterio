import assert from "node:assert/strict";
import events from "node:events";
import path from "node:path";

import * as lib from "@clusterio/lib";
import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";


// Stand-in for the Factorio child process, only exit and kill are used here.
class FakeProcess extends events.EventEmitter {
	killed = false;
	kill() {
		this.killed = true;
	}
}

function createStartedServer() {
	const server = new FactorioServer(path.join("test", "file", "factorio"), path.join("temp", "test", "server"), {});
	server._state = "running";
	server._rconReady = false;
	server._server = new FakeProcess();
	server._watchExit();
	// Instance keeps an error listener on the server for as long as it runs.
	server.on("error", () => {});
	return server;
}

// Fail instead of hanging if the call never settles.
async function withTimeout(promise, message) {
	let timeoutId;
	const timeout = new Promise((resolve, reject) => {
		timeoutId = setTimeout(() => reject(new Error(message)), 500);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timeoutId);
	}
}

describe("host/src/server", function() {
	describe("FactorioServer.stop()", function() {
		it("returns if the process exits before RCON is ready", async function() {
			const server = createStartedServer();
			const stopped = server.stop();
			server._server.emit("exit", 1, null);
			await withTimeout(stopped, "stop() did not resolve");
			assert.equal(server._state, "init");
			assert.equal(server.listenerCount("rcon-ready"), 0);
			assert.equal(server.listenerCount("error"), 1);
		});

		it("returns if the process fails before RCON is ready", async function() {
			const server = createStartedServer();
			const stopped = server.stop();
			// Failing to spawn emits an error event followed by exit.
			server._server.emit("error", Object.assign(new Error("spawn failed"), { code: "EACCES" }));
			await withTimeout(stopped, "stop() did not resolve");
			assert.equal(server._state, "init");
			assert.equal(server.listenerCount("rcon-ready"), 0);
			assert.equal(server.listenerCount("error"), 1);
		});

		it("does not reject if the process exits with an error before RCON is ready", async function() {
			const server = createStartedServer();
			const stopped = server.stop();
			// The wait rejects with this error, stopping succeeds regardless.
			server.emit("error", new lib.EnvironmentError("Factorio server was killed"));
			server._server.emit("exit", null, "SIGKILL");
			await assert.doesNotReject(withTimeout(stopped, "stop() did not resolve"));
			assert.equal(server._state, "init");
			assert.equal(server.listenerCount("rcon-ready"), 0);
			assert.equal(server.listenerCount("exit"), 0);
			assert.equal(server.listenerCount("error"), 1);
		});

		it("stops the server if RCON becomes ready", async function() {
			const server = createStartedServer();
			const stopped = server.stop();
			server._rconReady = true;
			server.emit("rcon-ready");
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(server.listenerCount("exit"), 0);
			const fakeProcess = server._server;
			assert.equal(fakeProcess.killed, true);
			fakeProcess.emit("exit", 0, null);
			await withTimeout(stopped, "stop() did not resolve");
		});
	});

	describe("FactorioServer.sendRcon()", function() {
		it("throws if the process is killed before RCON is ready", async function() {
			const server = createStartedServer();
			const sent = server.sendRcon("/version");
			// kill() sets the state before killing, which suppresses the error event.
			server._state = "stopping";
			server._server.emit("exit", null, "SIGKILL");
			await assert.rejects(
				withTimeout(sent, "sendRcon() did not settle"),
				new Error("RCON connection lost"),
			);
			assert.equal(server.listenerCount("rcon-ready"), 0);
			assert.equal(server.listenerCount("error"), 1);
		});

		it("throws the exit error if the process exits before RCON is ready", async function() {
			const server = createStartedServer();
			const sent = server.sendRcon("/version");
			// An unexpected exit emits why the server went away before the exit event.
			server._server.emit("exit", 1, null);
			await assert.rejects(
				withTimeout(sent, "sendRcon() did not settle"),
				new lib.EnvironmentError("Factorio server unexpectedly shut down with code 1"),
			);
			assert.equal(server.listenerCount("rcon-ready"), 0);
			assert.equal(server.listenerCount("exit"), 0);
			assert.equal(server.listenerCount("error"), 1);
		});
	});
});
