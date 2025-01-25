"use strict";
const assert = require("assert").strict;

const mock = require("../../../test/mock");
const instance = require("../dist/node/instance");
const info = require("../dist/node/index").plugin;


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
						surface_statistics: {
							"nauvis": {
								game_flow_statistics: {
									pollution_statistics: {
										input: { "boiler": 2000 },
										output: { "tree-proxy": 560 },
									},
								},
								force_flow_statistics: {
									player: {
										item_production_statistics: {
											input: { "inserter": 10 },
											output: { "iron-plate": 24 },
										},
									},
								},
							},
						},
						platforms: {
							"platform-1": {
								force: "player",
								surface: "nauvis",
								speed: 1,
								weight: 2,
							},
						},
					})
				);

				await instancePlugin.onMetrics();

				assert.equal(instance._instancePlayerCount.labels("7357").get(), 3);
				assert.equal(instance._instanceGameTicksTotal.labels("7357").get(), 100);
				assert.equal(instance._instanceForceFlowStatistics.labels(
					"7357", "nauvis", "player", "item_production_statistics", "input", "inserter").get(),
				10);
				assert.equal(instance._instanceForceFlowStatistics.labels(
					"7357", "nauvis", "player", "item_production_statistics", "output", "iron-plate").get(),
				24);
				// Assert that it didn't record inserter consumption as production
				assert.equal(instance._instanceForceFlowStatistics.labels(
					"7357", "nauvis", "player", "item_production_statistics", "output", "inserter").get(),
				0);
				assert.equal(instance._instanceGameFlowStatistics.labels(
					"7357", "nauvis", "pollution_statistics", "input", "boiler").get(),
				2000);
				assert.equal(instance._instanceGameFlowStatistics.labels(
					"7357", "nauvis", "pollution_statistics", "output", "tree-proxy").get(),
				560);
				assert.equal(instance._instancePlatformMapping.labels(
					"7357", "platform-1", "player", "nauvis").get(),
				1);
				assert.equal(instance._instancePlatformSpeed.labels(
					"7357", "player", "nauvis").get(),
				1);
				assert.equal(instance._instancePlatformWeight.labels(
					"7357", "player", "nauvis").get(),
				2);
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
