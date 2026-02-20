import type {
	ChartTagData,
	ChartTagDataEvent,
	PlayerPositionEvent,
	RecipeDataEvent,
	TileDataEvent,
} from "../messages";

export interface ChartTagDataWithInstance extends ChartTagData {
	instance_id: number;
}

export interface MinimapViewBounds {
	worldLeft: number;
	worldTop: number;
	worldRight: number;
	worldBottom: number;
}

export interface MinimapActiveView {
	changed: boolean;
	activeInstanceIds: number[];
}

export interface MinimapDataSource {
	setInstance?(instanceId: number | null): void;
	setSurfaceForce(surface: string, force: string): void;
	setActiveView(bounds: MinimapViewBounds): MinimapActiveView;
	isReady(): boolean;
	getTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null>;
	getRecipeTileData(tileX: number, tileY: number, tick?: number | null): Promise<Uint8Array | null>;
	getChartTags(): Promise<ChartTagDataWithInstance[]>;
	getPlayerPaths(): Promise<Array<{ instanceId: number; data: Uint8Array }>>;
	onTileUpdate(callback: (event: TileDataEvent) => void): () => void;
	onChartTagUpdate(callback: (event: ChartTagDataEvent) => void): () => void;
	onRecipeUpdate(callback: (event: RecipeDataEvent) => void): () => void;
	onPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void): () => void;
}
