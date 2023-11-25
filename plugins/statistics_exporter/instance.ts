import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";

const { Gauge } = lib;

type IpcStats = {
	game_tick: number,
	player_count: number,
	game_flow_statistics: {
		pollution_statistics: IpcFlowType,
	},
	force_flow_statistics: {
		[key:string]: {
			[key:string]: IpcFlowType,
		}
	},
}

type IpcFlowType = {
	"input": Record<string, number>,
	"output": Record<string, number>,
}

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

function setForceFlowStatistic(
	instanceId: number,
	forceName: string,
	statisticName: string,
	direction: string,
	item: string,
	value: number,
) {
	instanceForceFlowStatistics.labels(String(instanceId), forceName, statisticName, direction, item).set(value);

	// For item and fluid statistics it's useful to compare the input flow with the
	// output flow, to simplify the comparison ensure both directions have a value.
	if (["item_production_statistics", "fluid_production_statistic"].includes(statisticName)) {
		let reverseDirection = direction === "input" ? "output" : "input";
		instanceForceFlowStatistics.labels(String(instanceId), forceName, statisticName, reverseDirection, item);
	}
}


export class InstancePlugin extends BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("statistics_exporter plugin requires save patching.");
		}
	}

	async gatherMetrics() {
		let string = await this.sendRcon("/sc statistics_exporter.export()");
		let stats: IpcStats;
		try {
			stats = JSON.parse(string);
		} catch (err: any) {
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
		let timeout = this.instance.config.get("statistics_exporter.command_timeout") as number * 1000;
		await lib.timeout(this.gatherMetrics(), timeout, undefined);
	}
}

export const _instancePlayerCount = instancePlayerCount;
export const _instanceGameTicksTotal = instanceGameTicksTotal;
export const _instanceForceFlowStatistics = instanceForceFlowStatistics;
export const _instanceGameFlowStatistics = instanceGameFlowStatistics;
