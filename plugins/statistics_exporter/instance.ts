import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";

const { Gauge } = lib;

type IpcStats = {
	game_tick: number,
	player_count: number,
	surface_statistics: {
		[key: string]: {
			game_flow_statistics: {
				pollution_statistics: IpcFlowType,
			},
			force_flow_statistics: {
				[key:string]: {
					[key:string]: IpcFlowType,
				}
			},
		}
	},
	platforms: {
		[key: string]: {
			force: string,
			surface: string,
			speed: number,
			weight: number,
		}
	}
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
	{ labels: ["instance_id", "surface", "force", "statistic", "direction", "name"] },
);
const instanceGameFlowStatistics = new Gauge(
	"clusterio_statistics_exporter_instance_game_flow_statistics",
	"Pollution produced/consumed in the game",
	{ labels: ["instance_id", "surface", "statistic", "direction", "name"] },
);
const instancePlatformMapping = new Gauge(
	"clusterio_statistics_exporter_platform_mapping",
	"Mapping of platform name to force, surface and instance",
	{ labels: ["instance_id", "platform_name", "force", "surface"] }
);
const instancePlatformSpeed = new Gauge(
	"clusterio_statistics_exporter_platform_speed",
	"Current speed of the platform",
	{ labels: ["instance_id", "force", "surface"] }
);
const instancePlatformWeight = new Gauge(
	"clusterio_statistics_exporter_platform_weight",
	"Current weight/mass of the platform",
	{ labels: ["instance_id", "force", "surface"] }
);

function setForceFlowStatistic(
	instanceId: number,
	surfaceName: string,
	forceName: string,
	statisticName: string,
	direction: string,
	item: string,
	value: number,
) {
	instanceForceFlowStatistics.labels(
		String(instanceId),
		surfaceName,
		forceName,
		statisticName,
		direction,
		item
	).set(value);

	// For item and fluid statistics it's useful to compare the input flow with the
	// output flow, to simplify the comparison ensure both directions have a value.
	if (["item_production_statistics", "fluid_production_statistic"].includes(statisticName)) {
		let reverseDirection = direction === "input" ? "output" : "input";
		instanceForceFlowStatistics.labels(
			String(instanceId),
			surfaceName,
			forceName,
			statisticName,
			reverseDirection,
			item
		);
	}
}


export class InstancePlugin extends BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("statistics_exporter plugin requires save patching.");
		}
		if (!this.instance.config.get("factorio.enable_script_commands")) {
			throw new Error("statistics_exporter plugin requires script commands.");
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

		// Remove existing platform mappings and stats for this instance
		instancePlatformMapping.removeAll({ instance_id: String(instanceId) });
		instancePlatformSpeed.removeAll({ instance_id: String(instanceId) });
		instancePlatformWeight.removeAll({ instance_id: String(instanceId) });

		// Set new platform mappings and stats
		for (let [platformName, platform] of Object.entries(stats.platforms)) {
			instancePlatformMapping.labels(
				String(instanceId),
				platformName,
				platform.force,
				platform.surface
			).set(1);

			instancePlatformSpeed.labels(
				String(instanceId),
				platform.force,
				platform.surface
			).set(platform.speed);

			instancePlatformWeight.labels(
				String(instanceId),
				platform.force,
				platform.surface
			).set(platform.weight);
		}

		for (let [surfaceName, surfaceStats] of Object.entries(stats.surface_statistics)) {
			for (let [forceName, flowStatistics] of Object.entries(surfaceStats.force_flow_statistics)) {
				for (let [statisticName, statistic] of Object.entries(flowStatistics)) {
					for (let [direction, counts] of Object.entries(statistic)) {
						// eslint-disable-next-line max-depth
						for (let [item, value] of Object.entries(counts)) {
							setForceFlowStatistic(
								instanceId,
								surfaceName,
								forceName,
								statisticName,
								direction,
								item,
								value
							);
						}
					}
				}
			}

			for (let [direction, counts] of Object.entries(surfaceStats.game_flow_statistics.pollution_statistics)) {
				for (let [item, value] of Object.entries(counts)) {
					instanceGameFlowStatistics.labels(
						String(instanceId), surfaceName, "pollution_statistics", direction, item
					).set(value);
				}
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
		let timeoutMs = this.instance.config.get("statistics_exporter.command_timeout") * 1000;
		await lib.timeout(this.gatherMetrics(), timeoutMs, undefined);
	}
}

export const _instancePlayerCount = instancePlayerCount;
export const _instanceGameTicksTotal = instanceGameTicksTotal;
export const _instanceForceFlowStatistics = instanceForceFlowStatistics;
export const _instanceGameFlowStatistics = instanceGameFlowStatistics;
export const _instancePlatformMapping = instancePlatformMapping;
export const _instancePlatformSpeed = instancePlatformSpeed;
export const _instancePlatformWeight = instancePlatformWeight;
