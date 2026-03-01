import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import {
	TileDataEvent,
	ChartData,
	ChartTagDataEvent,
	ChartTagData,
	RecipeDataEvent,
	RecipeData,
	PlayerPositionEvent,
	PlayerData,
	PlayerSessionEndEvent,
} from "./messages";

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

interface PlayerPositionIpc {
	player_name: string;
	surface: string;
	x: number;
	y: number;
	sec: number;
}

interface PlayerSessionEndIpc {
	player_name: string;
	surface: string;
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

		// Listen for player position data from Lua module
		this.instance.server.on("ipc-minimap:player_position", (data: PlayerPositionIpc) => {
			this.handlePlayerPositionFromLua(data).catch(err => this.logger.error(
				`Error handling player position data from Lua:\n${err}`
			));
		});

		// Listen for player session end data from Lua module
		this.instance.server.on("ipc-minimap:player_session_end", (data: PlayerSessionEndIpc) => {
			this.handlePlayerSessionEndFromLua(data).catch(err => this.logger.error(
				`Error handling player session end data from Lua:\n${err}`
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

				TileDataEvents.map(event => this.instance.sendTo("controller", event));
			}

		} catch (err) {
			this.logger.error(`Failed to process tile data from Lua: ${err}`);
		}
	}

	async handleChartTagDataFromLua(data: ChartTagDataIpc) {
		try {
			// Validate the chart tag data
			if (!data || typeof data.tag_number !== "number") {
				this.logger.error("Invalid chart tag data received");
				return;
			}

			// Create chart tag data event
			const chartTagEvent = new ChartTagDataEvent(
				this.instance.config.get("instance.id"),
				data as ChartTagData
			);

			// Send to controller
			this.instance.sendTo("controller", chartTagEvent);
		} catch (err) {
			this.logger.error(`Failed to process chart tag data from Lua: ${err}`);
		}
	}

	async handleRecipeDataFromLua(data: RecipeDataIpc) {
		try {
			if (!data) {
				this.logger.error("Invalid recipe data received");
				return;
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

			this.instance.sendTo("controller", event);
		} catch (err: unknown) {
			this.logger.error(`Failed to process recipe data from Lua: ${err}`);
		}
	}

	async handlePlayerPositionFromLua(data: PlayerPositionIpc) {
		try {
			if (!data) {
				this.logger.error("Invalid player position data received");
				return;
			}

			const playerData: PlayerData = {
				player_name: data.player_name,
				surface: data.surface,
				x: data.x,
				y: data.y,
				sec: data.sec,
			};

			const event = new PlayerPositionEvent(
				this.instance.config.get("instance.id"),
				playerData
			);
			this.instance.sendTo("controller", event);
		} catch (err: unknown) {
			this.logger.error(`Failed to process player position data from Lua: ${err}`);
		}
	}

	async handlePlayerSessionEndFromLua(data: PlayerSessionEndIpc) {
		try {
			if (!data) {
				this.logger.error("Invalid player session end data received");
				return;
			}

			const event = new PlayerSessionEndEvent(
				this.instance.config.get("instance.id"),
				{
					player_name: data.player_name,
					surface: data.surface,
				}
			);
			this.instance.sendTo("controller", event);
		} catch (err: unknown) {
			this.logger.error(`Failed to process player session end data from Lua: ${err}`);
		}
	}
}
