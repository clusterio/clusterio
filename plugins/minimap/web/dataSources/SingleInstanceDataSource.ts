import type { Control } from "@clusterio/web_ui";
import {
	GetChartTagsRequest,
	GetPlayerPathRequest,
	GetRawRecipeTileRequest,
	GetRawTileRequest,
	type TileDataEvent,
	type ChartTagDataEvent,
	type RecipeDataEvent,
	type PlayerPositionEvent,
} from "../../messages";
import type {
	ChartTagDataWithInstance,
	MinimapActiveView,
	MinimapDataSource,
	MinimapViewBounds,
} from "../minimap-data-source";

interface MinimapWebPlugin {
	setInstanceSurfaceFilters?(filters: Array<{ instanceId: number; surface: string }> | null): Promise<void> | void;
	setInstanceSurfaceFilter?(instanceId: number | null, surface: string | null): Promise<void> | void;
	onTileUpdate(callback: (event: TileDataEvent) => void): void;
	offTileUpdate(callback: (event: TileDataEvent) => void): void;
	onChartTagUpdate(callback: (event: ChartTagDataEvent) => void): void;
	offChartTagUpdate(callback: (event: ChartTagDataEvent) => void): void;
	onRecipeUpdate(callback: (event: RecipeDataEvent) => void): void;
	offRecipeUpdate(callback: (event: RecipeDataEvent) => void): void;
	onPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void): void;
	offPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void): void;
}

const decodeBase64ToBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
};

export class SingleInstanceDataSource implements MinimapDataSource {
	private control: Control;
	private plugin: MinimapWebPlugin | null = null;
	private instanceId: number | null = null;
	private surface = "nauvis";
	private force = "player";
	private activeInstances: number[] = [];

	/**
	 * Data source for the canvas renderer that reads minimap data for a single selected instance.
	 *
	 * This bridges selection state to the minimap web plugin and keeps subscription filters in sync.
	 */
	constructor(control: Control) {
		this.control = control;
		this.plugin = control.plugins.get("minimap") as MinimapWebPlugin | undefined ?? null;
	}

	setInstance(instanceId: number | null): void {
		this.instanceId = instanceId;
		this.updateFilters();
	}

	setSurfaceForce(surface: string, force: string): void {
		this.surface = surface;
		this.force = force;
		this.updateFilters();
	}

	setActiveView(_bounds: MinimapViewBounds): MinimapActiveView {
		const nextActive = this.instanceId !== null ? [this.instanceId] : [];
		const changed = nextActive.length !== this.activeInstances.length
			|| nextActive.some((id, index) => id !== this.activeInstances[index]);
		if (changed) {
			this.activeInstances = nextActive;
		}
		return { changed, activeInstanceIds: [...this.activeInstances] };
	}

	isReady(): boolean {
		return this.instanceId !== null;
	}

	async getTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null> {
		if (this.instanceId === null) {
			return null;
		}
		const response = await this.control.send(new GetRawTileRequest(
			this.instanceId,
			this.surface,
			this.force,
			tileX,
			tileY,
			tick ?? undefined,
		));
		if (!response.tile_data) {
			return null;
		}
		return decodeBase64ToBytes(response.tile_data);
	}

	async getRecipeTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null> {
		if (this.instanceId === null) {
			return null;
		}
		const response = await this.control.send(new GetRawRecipeTileRequest(
			this.instanceId,
			this.surface,
			this.force,
			tileX,
			tileY,
			tick ?? undefined,
		));
		if (!response.recipe_tile) {
			return null;
		}
		return decodeBase64ToBytes(response.recipe_tile);
	}

	async getChartTags(): Promise<ChartTagDataWithInstance[]> {
		if (this.instanceId === null) {
			return [];
		}
		const response = await this.control.send(new GetChartTagsRequest(
			this.instanceId,
			this.surface,
			this.force,
		));
		return response.chart_tags.map(tag => ({
			...tag,
			instance_id: this.instanceId as number,
		}));
	}

	async getPlayerPaths(): Promise<Array<{ instanceId: number; data: Uint8Array }>> {
		if (this.instanceId === null) {
			return [];
		}
		const response = await this.control.send(new GetPlayerPathRequest(
			this.instanceId,
			this.surface,
		));
		if (!response.positions) {
			return [];
		}
		return [{ instanceId: this.instanceId, data: decodeBase64ToBytes(response.positions) }];
	}

	onTileUpdate(callback: (event: TileDataEvent) => void): () => void {
		this.plugin?.onTileUpdate(callback);
		return () => {
			this.plugin?.offTileUpdate(callback);
		};
	}

	onChartTagUpdate(callback: (event: ChartTagDataEvent) => void): () => void {
		this.plugin?.onChartTagUpdate(callback);
		return () => {
			this.plugin?.offChartTagUpdate(callback);
		};
	}

	onRecipeUpdate(callback: (event: RecipeDataEvent) => void): () => void {
		this.plugin?.onRecipeUpdate(callback);
		return () => {
			this.plugin?.offRecipeUpdate(callback);
		};
	}

	onPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void): () => void {
		this.plugin?.onPlayerPositionUpdate(callback);
		return () => {
			this.plugin?.offPlayerPositionUpdate(callback);
		};
	}

	private updateFilters() {
		if (!this.plugin) {
			return;
		}
		if (this.instanceId === null) {
			if (this.plugin.setInstanceSurfaceFilters) {
				this.plugin.setInstanceSurfaceFilters(null);
			} else if (this.plugin.setInstanceSurfaceFilter) {
				this.plugin.setInstanceSurfaceFilter(null, null);
			}
			return;
		}
		const filters = [{ instanceId: this.instanceId, surface: this.surface }];
		// Support both the newer multi-filter API and the legacy single-filter API.
		if (this.plugin.setInstanceSurfaceFilters) {
			this.plugin.setInstanceSurfaceFilters(filters);
		} else if (this.plugin.setInstanceSurfaceFilter) {
			this.plugin.setInstanceSurfaceFilter(this.instanceId, this.surface);
		}
	}
}
