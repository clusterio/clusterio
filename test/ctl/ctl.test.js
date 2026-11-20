import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { Ctl } from "@clusterio/ctl/dist/node/ctl.js";
import { CommandOutput } from "@clusterio/ctl/dist/node/src/command_ops.js";

/** Run fn and return the lines it printed with console.log */
async function captureLog(fn) {
	const lines = [];
	const originalLog = console.log; // eslint-disable-line no-console
	console.log = (...args) => lines.push(args.join(" ")); // eslint-disable-line no-console
	try {
		await fn();
	} finally {
		console.log = originalLog; // eslint-disable-line no-console
	}
	return lines;
}

describe("ctl/ctl", function() {
	describe("class Ctl", function() {
		let ctl;
		beforeEach(function() {
			const connector = new lib.VirtualConnector(
				lib.Address.fromShorthand({ controlId: 1 }),
				lib.Address.fromShorthand("controller"),
			);
			ctl = new Ctl(connector, new lib.CtlConfig("control"));
		});

		it("prints log events as JSON lines only when streaming the log", async function() {
			const info = { level: "info", message: "hello" };
			ctl.output = new CommandOutput("json");
			const logged = await captureLog(() => ctl.handleLogMessageEvent(new lib.LogMessageEvent({ ...info })));
			assert(logged.every(line => !line.startsWith("{")), "log event printed as a result");
			ctl.output.streamingLog = true;
			assert.deepEqual(
				await captureLog(() => ctl.handleLogMessageEvent(new lib.LogMessageEvent({ ...info, timestamp: 1 }))),
				['{"level":"info","message":"hello","timestamp":1}'],
			);
		});
		it("logs log events in human mode", async function() {
			ctl.output.streamingLog = true;
			const info = { level: "verbose", message: "hello" };
			assert.deepEqual(await captureLog(() => ctl.handleLogMessageEvent(new lib.LogMessageEvent(info))), []);
		});
		it("prints debug WebSocket messages", async function() {
			const event = new lib.DebugWsMessageEvent("in", "content");
			assert.deepEqual(await captureLog(() => ctl.handleDebugWsMessageEvent(event)), ["WS in content"]);
			ctl.output = new CommandOutput("json");
			assert.deepEqual(
				await captureLog(() => ctl.handleDebugWsMessageEvent(event)),
				['{"direction":"in","content":"content"}'],
			);
		});
	});
});
