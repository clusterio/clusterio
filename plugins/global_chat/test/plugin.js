import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

import * as mock from "../../../test/mock.js";
import * as lines from "../../../test/lib/factorio/lines.js";
import * as instance from "../dist/node/instance.js";
import { plugin as info } from "../dist/node/index.js";
import { ChatEvent } from "../dist/node/messages.js";

describe("global_chat plugin", function() {
	describe("removeTags()", function() {
		it("should pass through an ordinary string", function() {
			assert.equal(instance._removeTags("string"), "string");
		});
		it("should strip out gps tag", function() {
			assert.equal(instance._removeTags("Look at [gps=12,-4,nauvis]"), "Look at ");
		});
		it("should strip out special item tag", function() {
			assert.equal(instance._removeTags("Blueprint [special-item=0eNqV...]"), "Blueprint ");
		});
		it("should strip out train tag", function() {
			assert.equal(instance._removeTags("Train [train=1235]"), "Train ");
		});
		it("should strip out train stop tag", function() {
			assert.equal(instance._removeTags("Stop [train-stop=42]"), "Stop ");
		});
		it("should preserve portable rich text tags", function() {
			assert.equal(
				instance._removeTags("[gps=12,-4][img=item.iron-plate] [item=iron-plate]"),
				"[img=item.iron-plate] [item=iron-plate]",
			);
		});
	});

	describe("instance entrypoint", function() {
		let mockInstance;

		before(async function() {
			try {
				lib.registerPluginMessages([info]);
			} catch (err) {
				// Already registered by the full test suite
			}
			({ instance: mockInstance } = await mock.loadInstancePlugin(instance.default, info));
		});

		describe("ChatEvent handler", function() {
			it("should send received chat as command", async function() {
				mockInstance.server.rconCommands = [];
				await mock.getHandler(mockInstance, ChatEvent)(new ChatEvent("test", "User: message"));
				assert.deepEqual(
					mockInstance.server.rconCommands,
					["/sc game.print('[test] User: message')"],
				);
			});
			it("should filter server-specific tags from received chat", async function() {
				mockInstance.server.rconCommands = [];
				await mock.getHandler(mockInstance, ChatEvent)(new ChatEvent("test", "Train [train=1235]"));
				assert.deepEqual(
					mockInstance.server.rconCommands,
					["/sc game.print('[test] Train ')"],
				);
			});
		});
		describe("output hook", function() {
			it("should forward chat", async function() {
				let count = 0;
				for (let [line, output] of lines.testLines) {
					if (output.type === "action" && output.action === "CHAT") {
						mockInstance.connector.sentMessages = [];
						await mockInstance.hooks.output.invoke(output, line);
						assert(mockInstance.connector.sentMessages.length, "message was not sent");
						count += 1;
					}
				}
				assert(count > 0, "no lines were tested");
			});
			it("should ignore regular output", async function() {
				let count = 0;
				for (let [line, output] of lines.testLines) {
					if (output.type !== "action" || output.action !== "CHAT") {
						mockInstance.connector.sentMessages = [];
						await mockInstance.hooks.output.invoke(output, line);
						assert(!mockInstance.connector.sentMessages.length, "message was sent");
						count += 1;
					}
				}
				assert(count > 0, "no lines were tested");
			});
		});
	});
});
