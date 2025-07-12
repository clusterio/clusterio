import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import { TileDataEvent, ChartData } from "./messages";

interface TileDataIpc {
	type: "chart";
	data: ChartData[];
	position: [number, number];
}

export class InstancePlugin extends BaseInstancePlugin {
	pendingTileUpdates = new Map<string, Set<[number, number, [number, number, number, number]]>>();

	async init() {
		if (!this.instance.config.get("factorio.enable_script_commands")) {
			throw new Error("minimap plugin requires script commands to be enabled.");
		}

		// Listen for tile data from the Lua module
		this.instance.server.on("ipc-minimap:tile_data", (data: TileDataIpc) => {
			this.handleTileDataFromLua(data).catch(err => this.logger.error(
				`Error handling tile data from Lua:\n${err}`
			));
		});
	}

	async handleTileDataFromLua(data: TileDataIpc) {
		try {
			const { type, data: rawData, position } = data;
			
			if (type === "chart") {
				// Handle new chart data format
				const chartData = rawData as ChartData[];
				
				if (!chartData || !Array.isArray(chartData)) {
					this.logger.error("Invalid chart data received");
					return;
				}

				// Send chart data to controller
				const event = new TileDataEvent(
					"chart",
					chartData,
					position!,
					this.instance.config.get("instance.id")
				);

				return this.instance.sendTo("controller", event);
			}
			
		} catch (err) {
			this.logger.error(`Failed to process tile data from Lua: ${err}`);
		}
	}

	async onStart() {
		// Initialize the Lua module when the instance starts
		try {
			await this.sendRcon("/sc if not storage.minimap then storage.minimap = {} end");
			
			// Set up periodic tile updates every 30 seconds
			await this.sendRcon(`/sc 
				if not storage.minimap.update_timer then
					storage.minimap.update_timer = 0
					storage.minimap.update_interval = 1800 -- 30 seconds at 60 UPS
				end
			`);

			this.logger.info("Minimap plugin initialized on instance");
		} catch (err) {
			this.logger.error(`Failed to initialize minimap on instance: ${err}`);
		}
	}

	async onOutput(output: lib.ParsedFactorioOutput) {
		// Handle any special output parsing if needed for tile data
		if (output.type === "action" && output.action === "CUSTOM") {
			// Could handle custom factorio output here if the Lua module sends special messages
		}
	}
} 
