import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import { TileDataEvent, ChartData, ChartTagDataEvent, ChartTagData, RecipeDataEvent, RecipeData } from "./messages";

interface TileDataIpc {
	type: "chart";
	data: ChartData[];
	position: [number, number];
	tick: number;
}

interface ChartTagDataIpc {
	tag_number: number;
	start_tick: number | null;
	end_tick: number | null;
	force: string;
	surface: string;
	position: [number, number];
	text: string;
	icon: string | null;
	last_user: string | null;
}

interface RecipeDataIpc {
	tag_number?: number
	start_tick: number | null
	end_tick: number | null
	surface: string
	force: string
	position: [number, number]
	recipe: string | null
	icon?: { type?: string, name?: string, quality?: string }
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

		// Listen for chart tag data from the Lua module
		this.instance.server.on("ipc-minimap:chart_tag_data", (data: ChartTagDataIpc) => {
			this.handleChartTagDataFromLua(data).catch(err => this.logger.error(
				`Error handling chart tag data from Lua:\n${err}`
			));
		});

		// Listen for recipe data from Lua module
		this.instance.server.on("ipc-minimap:recipe_data", (data: RecipeDataIpc) => {
			this.handleRecipeDataFromLua(data).catch(err => this.logger.error(
				`Error handling recipe data from Lua:\n${err}`
			));
		});
	}

	async handleTileDataFromLua(data: TileDataIpc) {
		try {
			const { type, data: rawData, position, tick } = data;
			
			if (type === "chart") {
				// Handle new chart data format
				const chartData = rawData as ChartData[];
				
				if (!chartData || !Array.isArray(chartData)) {
					this.logger.error("Invalid chart data received");
					return;
				}

				// Send chart data to controller
				const TileDataEvents = chartData.map(chart => new TileDataEvent(
					this.instance.config.get("instance.id"),
					chart.surface,
					chart.force,
					position[0],
					position[1],
					tick,
					chart
				));

				return Promise.all(TileDataEvents.map(event => this.instance.sendTo("controller", event)));
			}
			
		} catch (err) {
			this.logger.error(`Failed to process tile data from Lua: ${err}`);
		}
	}

	async handleChartTagDataFromLua(data: ChartTagDataIpc) {
		// Validate the chart tag data
		if (!data || typeof data.tag_number !== 'number') {
			this.logger.error("Invalid chart tag data received");
			return;
		}

		// Create chart tag data event
		const chartTagEvent = new ChartTagDataEvent(
			this.instance.config.get("instance.id"),
			data as ChartTagData
		);

		// Send to controller
		return this.instance.sendTo("controller", chartTagEvent);
	}

	async handleRecipeDataFromLua(data: RecipeDataIpc) {
		try {
			if (!data) {
				this.logger.error("Invalid recipe data received")
				return
			}

			const recipeData: RecipeData = {
				start_tick: data.start_tick ?? undefined,
				end_tick: data.end_tick ?? undefined,
				surface: data.surface,
				force: data.force,
				position: data.position,
				recipe: data.recipe ?? undefined,
				icon: data.icon ?? undefined,
			};

			const event = new RecipeDataEvent(
				this.instance.config.get("instance.id"),
				recipeData
			);

			return this.instance.sendTo("controller", event);

		} catch (err: unknown) {
			this.logger.error(`Failed to process recipe data from Lua: ${err}`);
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
