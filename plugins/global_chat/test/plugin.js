"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");

const mock = require("../../../test/mock");
const lines = require("../../../test/lib/factorio/lines");
const instance = require("../dist/node/instance");
const info = require("../dist/node/index").plugin;
const { ChatEvent } = require("../dist/node/messages");


describe("global_chat plugin", function() {
	describe("removeTags()", function() {
		it("should pass through an ordinary string", function() {
			assert.equal(instance._removeTags("string"), "string");
		});
		it("should strip out gps tag", function() {
			assert.equal(instance._removeTags("Look at [gps=12,-4]"), "Look at ");
		});
		it("should strip out train tag", function() {
			assert.equal(instance._removeTags("Train [train=1235]"), "Train ");
		});
	});

	describe("class InstancePlugin", function() {
		let instancePlugin;

		before(async function() {
			instancePlugin = new instance.InstancePlugin(info, new mock.MockInstance(), new mock.MockHost());
			await instancePlugin.init();
		});

		describe(".handleChatEvent()", function() {
			it("should send received chat as command", async function() {
				instancePlugin.instance.server.rconCommands = [];
				await instancePlugin.handleChatEvent(new ChatEvent("test", "User: message"));
				assert.deepEqual(
					instancePlugin.instance.server.rconCommands,
					["/sc game.print('[test] User: message')"],
				);
			});
		});
		describe(".onOutput()", function() {
			it("should forward chat", async function() {
				let count = 0;
				for (let [_, output] of lines.testLines) {
					if (output.type === "action" && output.action === "CHAT") {
						instancePlugin.instance.connector.sentMessages = [];
						await instancePlugin.onOutput(output);
						assert(instancePlugin.instance.connector.sentMessages.length, "message was not sent");
						count += 1;
					}
				}
				assert(count > 0, "no lines were tested");
			});
			it("should ignore regular output", async function() {
				let count = 0;
				for (let [_, output] of lines.testLines) {
					if (output.type !== "action" || output.action !== "CHAT") {
						instancePlugin.instance.connector.sentMessages = [];
						await instancePlugin.onOutput(output);
						assert(!instancePlugin.instance.connector.sentMessages.length, "message was sent");
						count += 1;
					}
				}
				assert(count > 0, "no lines were tested");
			});
		});
	});
});
