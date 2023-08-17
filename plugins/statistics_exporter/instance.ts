"use strict";
const lib = require("@clusterio/lib");
const { Gauge } = lib;


const instancePlayerCount = new Gauge(
	"clusterio_statistics_exporter_instance_player_count",
	"Amount of players connected to this cluster",
	{ labels: ["instance_id"] }
);
const instanceGameTicksTotal = new Gauge(
	"clusterio_statistics_exporter_instance_game_ticks_total",
	"Game tick an instance has progressed to",
	{ labels: ["instance_id"] }
);
const instanceForceFlowStatistics = new Gauge(
	"clusterio_statistics_exporter_instance_force_flow_statistics",
	"Items/fluids/enemies/buildings produced/built/killed by a force",
	{ labels: ["instance_id", "force", "statistic", "direction", "name"] },
);
const instanceGameFlowStatistics = new Gauge(
	"clusterio_statistics_exporter_instance_game_flow_statistics",
	"Pollution produced/consumed in the game",
	{ labels: ["instance_id", "statistic", "direction", "name"] },
);

function setForceFlowStatistic(instanceId, forceName, statisticName, direction, item, value) {
	instanceForceFlowStatistics.labels(String(instanceId), forceName, statisticName, direction, item).set(value);

	// For item and fluid statistics it's useful to compare the input flow with the
	// output flow, to simplify the comparison ensure both directions have a value.
	if (["item_production_statistics", "fluid_production_statistic"].includes(statisticName)) {
		let reverseDirection = direction === "input" ? "output" : "input";
		instanceForceFlowStatistics.labels(String(instanceId), forceName, statisticName, reverseDirection, item);
	}
}


class InstancePlugin extends lib.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("statistics_exporter plugin requires save patching.");
		}
	}

	async gatherMetrics() {
		let string = await this.sendRcon("/sc statistics_exporter.export()");
		let stats;
		try {
			stats = JSON.parse(string);
		} catch (err) {
			throw new Error(`Error parsing statistics JSON: ${err.message}, content "${string}"`);
		}

		let instanceId = this.instance.id;
		instanceGameTicksTotal.labels(String(instanceId)).set(stats.game_tick);
		instancePlayerCount.labels(String(instanceId)).set(stats.player_count);

		for (let [forceName, flowStatistics] of Object.entries(stats.force_flow_statistics)) {
			for (let [statisticName, statistic] of Object.entries(flowStatistics)) {
				for (let [direction, counts] of Object.entries(statistic)) {
					for (let [item, value] of Object.entries(counts)) {
						setForceFlowStatistic(instanceId, forceName, statisticName, direction, item, value);
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

	async onMetrics() {
		if (this.instance.status !== "running") {
			return;
		}

		// Wait configured timeout for the metrics to be collected.  It may
		// take a long time for the command to go through if the command
		// stream is overloaded.  Should the timeout be exceeded the
		// previous values for the metrics will end up being sent to controller.
		let timeout = this.instance.config.get("statistics_exporter.command_timeout") * 1000;
		await lib.timeout(this.gatherMetrics(), timeout);
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
