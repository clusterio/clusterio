"use strict";
const plugin = require("lib/plugin");
const { Gauge } = require("lib/prometheus");


const instancePlayerCount = new Gauge(
	"clusterio_statistics_exporter_instance_player_count", "Amount of players connected to this cluster",
	{ labels: ["instance_id"] }
);
const instanceGameTicksTotal = new Gauge(
	"clusterio_statistics_exporter_instance_game_ticks_total", "Game tick an instance has progressed to",
	{ labels: ["instance_id"] }
);
const instanceForceFlowStatistics = new Gauge(
	"clusterio_statistics_exporter_instance_force_flow_statistics", "Items/fluids/enemies/buildings produced/built/killed by a force",
	{ labels: ["instance_id", "force", "statistic", "direction", "name"] },
);
const instanceGameFlowStatistics = new Gauge(
	"clusterio_statistics_exporter_instance_game_flow_statistics", "Pollution produced/consumed in the game",
	{ labels: ["instance_id", "statistic", "direction", "name"] },
);


class InstancePlugin extends plugin.BaseInstancePlugin {
	async onMetrics() {
		let string = await this.instance.server.sendRcon("/sc statistics_exporter.export()");
		let stats;
		try {
			stats = JSON.parse(string);
		} catch (err) {
			throw new Error(`Error parsing statistics JSON: ${err.message}, content "${string}"`);
		}

		let instanceId = this.instance.config.get("instance.id");
		instanceGameTicksTotal.labels(String(instanceId)).set(stats.game_tick);
		instancePlayerCount.labels(String(instanceId)).set(stats.player_count);

		for (let [forceName, flowStatistics] of Object.entries(stats.force_flow_statistics)) {
			for (let [statisticName, statistic] of Object.entries(flowStatistics)) {
				for (let [direction, counts] of Object.entries(statistic)) {
					for (let [item, value] of Object.entries(counts)) {
						instanceForceFlowStatistics.labels(
							String(instanceId), forceName, statisticName, direction, item
						).set(value);
					}
				}
			}
		}

		for (let [direction, counts] of Object.entries(stats.game_flow_statistics.pollution_statistics)) {
			for (let [item, value] of Object.entries(counts)) {
				instanceGameFlowStatistics.labels(
					String(instanceId), "pollution_statistics", direction, item
				).set(value);
			}
		}
	}
}

module.exports = {
	InstancePlugin,

	// For testing only
	_instancePlayerCount: instancePlayerCount,
	_instanceGameTicksTotal: instanceGameTicksTotal,
	_instanceForceFlowStatistics: instanceForceFlowStatistics,
	_instanceGameFlowStatistics: instanceGameFlowStatistics,
};
