"use strict";
const assert = require("assert").strict;

const mock = require("../../../test/mock");
const instance = require("../instance");
const info = require("../info").default;


describe("statistics_exporter plugin", function() {
	describe("class InstancePlugin", function() {
		let instancePlugin;
		let mockInstance = new mock.MockInstance();
		mockInstance.mockConfigEntries.set("statistics_exporter.command_timeout", 1);
		before(async function() {
			instancePlugin = new instance.InstancePlugin(info, mockInstance);
			await instancePlugin.init();
		});

		describe(".onMetrics()", function() {
			it("should not send commands before running", async function() {
				instancePlugin.instance.server.rconCommands.length = 0;
				instancePlugin.instance.status = "starting";
				await instancePlugin.onMetrics();
				assert(instancePlugin.instance.server.rconCommands.length === 0, "commands were run");
			});
			it("should record statistics", async function() {
				instancePlugin.instance.status = "running";
				instancePlugin.instance.server.rconCommandResults.set(
					"/sc statistics_exporter.export()",
					JSON.stringify({
						game_tick: 100,
						player_count: 3,
						force_flow_statistics: {
							player: {
								item_production_statistics: {
									input: { "inserter": 10 },
									output: { "iron-plate": 24 },
								},
							},
						},
						game_flow_statistics: {
							pollution_statistics: {
								input: { "boiler": 2000 },
								output: { "tree-proxy": 560 },
							},
						},
					})
				);

				await instancePlugin.onMetrics();

				assert.equal(instance._instancePlayerCount.labels("7357").get(), 3);
				assert.equal(instance._instanceGameTicksTotal.labels("7357").get(), 100);
				assert.equal(instance._instanceForceFlowStatistics.labels(
					"7357", "player", "item_production_statistics", "input", "inserter").get(),
				10);
				assert.equal(instance._instanceGameFlowStatistics.labels(
					"7357", "pollution_statistics", "input", "boiler").get(),
				2000);
			});
			it("should pass on JSON parse errors", async function() {
				let string = "An error occured\n";
				instancePlugin.instance.server.rconCommandResults.set(
					"/sc statistics_exporter.export()", string
				);

				let errorMessage;
				try {
					JSON.parse(string);
				} catch (err) {
					errorMessage = err.message;
				}

				await assert.rejects(
					instancePlugin.onMetrics(),
					new Error(`Error parsing statistics JSON: ${errorMessage}, content "${string}"`)
				);
			});
		});
	});
});
