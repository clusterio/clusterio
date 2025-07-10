import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import { TileDataEvent, GetTileDataRequest } from "./messages";

interface TileDataIpc {
	type: "tiles" | "pixels";
	data: string;
	position?: [number, number];
	size?: number;
	layer?: string;
}

export class InstancePlugin extends BaseInstancePlugin {
	pendingTileUpdates = new Map<string, Set<[number, number, [number, number, number, number]]>>();

	async init() {
		if (!this.instance.config.get("factorio.enable_script_commands")) {
			throw new Error("minimap plugin requires script commands to be enabled.");
		}

		this.instance.handle(GetTileDataRequest, this.handleGetTileDataRequest.bind(this));

		// Listen for tile data from the Lua module
		this.instance.server.on("ipc-minimap:tile_data", (data: TileDataIpc) => {
			this.handleTileDataFromLua(data).catch(err => this.logger.error(
				`Error handling tile data from Lua:\n${err}`
			));
		});
	}

	async handleGetTileDataRequest(request: GetTileDataRequest): Promise<{ tileData: string[] }> {
		const { area } = request;
		try {
			// Send command to Lua to dump tile data for the specified area
			const command = `/sc minimap.dump_mapview({${area.x1}, ${area.y1}}, {${area.x2}, ${area.y2}})`;
			const response = await this.sendRcon(command);
			
			// Parse the response - it should be a semicolon-separated string of hex colors
			const tileData = response ? response.split(";").filter(data => data.length > 0) : [];
			
			return { tileData };
		} catch (err) {
			this.logger.error(`Failed to get tile data: ${err}`);
			return { tileData: [] };
		}
	}

	async handleTileDataFromLua(data: TileDataIpc) {
		try {
			// Parse the incoming data
			const tileData = data.data.split(";").filter(segment => segment.length > 0);
			
			if (tileData.length === 0) {
				return;
			}

			// Send tile data to controller
			const event = new TileDataEvent(
				data.type,
				tileData,
				data.position || null,
				data.size || null,
				this.instance.config.get("instance.id"),
				data.layer || ""
			);

			await this.instance.sendTo("controller", event);
			
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
