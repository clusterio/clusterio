import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";
import { CommandOutput, errorToJson, toPlain } from "@clusterio/ctl/dist/node/src/command_ops.js";

/** Run fn and return the lines it printed with console.log */
function captureLog(fn) {
	const lines = [];
	const originalLog = console.log; // eslint-disable-line no-console
	console.log = (...args) => lines.push(args.join(" ")); // eslint-disable-line no-console
	try {
		fn();
	} finally {
		console.log = originalLog; // eslint-disable-line no-console
	}
	return lines;
}

describe("ctl/command_ops", function() {
	describe("toPlain()", function() {
		it("converts Sets, Maps and Dates", function() {
			assert.deepEqual(
				toPlain({ set: new Set([1, 2]), map: new Map([[3, { a: new Set(["b"]) }]]), date: new Date(0) }),
				{ set: [1, 2], map: { 3: { a: ["b"] } }, date: "1970-01-01T00:00:00.000Z" },
			);
		});
		it("uses own properties instead of toJSON", function() {
			const role = new lib.Role(1, "name", "desc", new Set(["core.admin"]));
			assert.deepEqual(toPlain(role).permissions, ["core.admin"]);
		});
	});

	describe("errorToJson()", function() {
		it("uses the class name of the error", function() {
			assert.deepEqual(errorToJson(new lib.NotFoundError("gone")), { error: "NotFoundError", message: "gone" });
			assert.deepEqual(errorToJson("text"), { error: "Error", message: "text" });
		});
	});

	describe("class CommandOutput", function() {
		it("calls the human formatter in human mode", function() {
			const output = new CommandOutput("human");
			const human = () => console.log("human"); // eslint-disable-line no-console
			assert.deepEqual(captureLog(() => output.result({ a: 1 }, human)), ["human"]);
			assert.deepEqual(captureLog(() => output.finish()), []);
		});
		it("prints a success line in human mode for commands without a result", function() {
			assert.deepEqual(captureLog(() => new CommandOutput("human").finish()), ["Command ran successfully"]);
		});
		it("prints one line of JSON per result in json mode", function() {
			const output = new CommandOutput("json");
			const lines = captureLog(() => {
				output.result({ a: new Set([1]) }, () => assert.fail("called human formatter"));
				output.table([{ b: 2 }]);
				output.finish();
			});
			assert.deepEqual(lines, ['{"a":[1]}', '[{"b":2}]']);
		});
		it("prints the toJSON format in wire mode", function() {
			const output = new CommandOutput("wire");
			const role = new lib.Role(1, "name", "desc", new Set(["core.admin"]));
			const lines = captureLog(() => output.result({ role, set: new Set([1]), map: new Map([["a", 2]]) }));
			assert.deepEqual(JSON.parse(lines[0]), { role: JSON.parse(JSON.stringify(role)), set: [1], map: { a: 2 } });
		});
		it("prints success for commands without a result", function() {
			assert.deepEqual(captureLog(() => new CommandOutput("json").finish()), ['{"success":true}']);
			const streaming = new CommandOutput("json");
			streaming.streaming = true;
			assert.deepEqual(captureLog(() => streaming.finish()), []);
		});
		it("prints errors as JSON", function() {
			const output = new CommandOutput("json");
			const lines = captureLog(() => {
				output.error(new lib.CommandError("failed"));
				output.finish();
			});
			assert.deepEqual(lines, ['{"error":"CommandError","message":"failed"}']);
		});
	});
});
