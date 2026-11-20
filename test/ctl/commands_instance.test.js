import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { instanceCommands } from "@clusterio/ctl/dist/node/src/commands_instance.js";
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

describe("ctl/commands_instance", function() {
	let instances;
	let sentTo;
	const ctl = {
		output: new CommandOutput(),
		async send(message) {
			assert(message instanceof lib.InstanceDetailsListRequest);
			return instances;
		},
		async sendTo(destination, message) {
			sentTo.push([destination.instanceId, message.constructor.name]);
			if (destination.instanceId === 2) {
				throw new lib.CommandError("broken");
			}
		},
	};
	beforeEach(function() {
		sentTo = [];
		instances = [
			{ id: 1, name: "one", status: "stopped", excludeFromStartAll: false },
			{ id: 2, name: "two", status: "stopped", excludeFromStartAll: false },
			{ id: 3, name: "three", status: "stopped", excludeFromStartAll: true },
			{ id: 4, name: "four", status: "running", excludeFromStartAll: false },
		];
	});

	describe("start-all", function() {
		const startAll = instanceCommands.get("start-all");
		it("starts stopped instances and reports each one", async function() {
			ctl.output = new CommandOutput("human");
			const lines = await captureLog(() => startAll.run({ force: false }, ctl));
			assert.deepEqual(sentTo, [[1, "InstanceStartRequest"], [2, "InstanceStartRequest"]]);
			assert(lines.includes("✓ Started one"), lines.join("\n"));
			assert(lines.some(line => line.startsWith("✗ Failed to start two")), lines.join("\n"));
		});
		it("prints an entry per instance in json mode", async function() {
			ctl.output = new CommandOutput("json");
			const lines = await captureLog(() => startAll.run({ force: true }, ctl));
			assert.deepEqual(JSON.parse(lines[0]), [
				{ id: 1, name: "one" },
				{ id: 2, name: "two", error: { error: "CommandError", message: "broken" } },
				{ id: 3, name: "three" },
			]);
		});
		it("reports when there is nothing to start", async function() {
			instances = [];
			ctl.output = new CommandOutput("human");
			assert.deepEqual(await captureLog(() => startAll.run({ force: false }, ctl)), ["No instances to start."]);
		});
	});

	describe("stop-all", function() {
		const stopAll = instanceCommands.get("stop-all");
		it("stops running instances and reports each one", async function() {
			instances[1].status = "running";
			ctl.output = new CommandOutput("human");
			const lines = await captureLog(() => stopAll.run({}, ctl));
			assert.deepEqual(sentTo, [[2, "InstanceStopRequest"], [4, "InstanceStopRequest"]]);
			assert(lines.includes("✓ Stopped four"), lines.join("\n"));
			assert(lines.some(line => line.startsWith("✗ Failed to stop two")), lines.join("\n"));
		});
		it("prints an entry per instance in json mode", async function() {
			ctl.output = new CommandOutput("json");
			const lines = await captureLog(() => stopAll.run({}, ctl));
			assert.deepEqual(JSON.parse(lines[0]), [{ id: 4, name: "four" }]);
		});
		it("reports when there is nothing to stop", async function() {
			instances = [];
			ctl.output = new CommandOutput("human");
			assert.deepEqual(await captureLog(() => stopAll.run({}, ctl)), ["No instances to stop."]);
		});
	});
});
