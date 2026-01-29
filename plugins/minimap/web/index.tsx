import React from "react";
import { BaseWebPlugin } from "@clusterio/web_ui";
import * as lib from "@clusterio/lib";
import CanvasMinimapPage from "./CanvasMinimapPage";
export { default as CanvasMinimapPage } from "./CanvasMinimapPage";
export { SingleInstanceDataSource } from "./dataSources/SingleInstanceDataSource";
export type {
	ChartTagDataWithInstance,
	MinimapActiveView,
	MinimapDataSource,
	MinimapViewBounds,
} from "./minimap-data-source";
export {
	GetRawTileRequest,
	GetRawRecipeTileRequest,
	GetChartTagsRequest,
	GetPlayerPathRequest,
} from "../messages";
import { TileDataEvent, ChartTagDataEvent, RecipeDataEvent, PlayerPositionEvent } from "../messages";

export class WebPlugin extends BaseWebPlugin {
	// Callback arrays for minimap updates
	tileUpdateCallbacks: Array<(event: TileDataEvent) => void> = [];
	chartTagUpdateCallbacks: Array<(event: ChartTagDataEvent) => void> = [];
	recipeUpdateCallbacks: Array<(event: RecipeDataEvent) => void> = [];
	playerPositionUpdateCallbacks: Array<(event: PlayerPositionEvent) => void> = [];

	// Track subscription state
	private subscribed = false;
	private currentFilters: string[] | undefined = undefined;

	async init() {
		this.pages = [
			{
				path: "/minimap",
				sidebarName: "Minimap",
				permission: "minimap.view",
				content: <CanvasMinimapPage />,
			},
		];

		// Handle minimap events from the controller
		this.control.handle(TileDataEvent, this.handleTileDataEvent.bind(this));
		this.control.handle(ChartTagDataEvent, this.handleChartTagDataEvent.bind(this));
		this.control.handle(RecipeDataEvent, this.handleRecipeDataEvent.bind(this));
		this.control.handle(PlayerPositionEvent, this.handlePlayerPositionEvent.bind(this));
	}

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
		if (event === "connect" || event === "resume") {
			this.updateSubscriptions();
		}
	}

	// Update instance/surface filters used for subscriptions.
	async setInstanceSurfaceFilters(filters: Array<{ instanceId: number; surface: string }> | null) {
		const newFilters = filters && filters.length > 0
			? filters.map(filter => `${filter.instanceId}:${filter.surface}`)
			: undefined;

		// No change
		const prev = this.currentFilters;
		const same = (
			(prev === undefined && newFilters === undefined)
			|| (Array.isArray(prev) && Array.isArray(newFilters)
				&& prev.length === newFilters.length
				&& prev.every((v, i) => v === newFilters[i]))
		);
		if (same) { return; }

		// If we had previous filters and callbacks active, remove those filters first
		if (this.hasActiveCallbacks() && prev && prev.length > 0) {
			try {
				await this.control.send(new lib.SubscriptionRequest("minimap:TileDataEvent", false, 0, prev));
				await this.control.send(new lib.SubscriptionRequest("minimap:ChartTagDataEvent", false, 0, prev));
				await this.control.send(new lib.SubscriptionRequest("minimap:RecipeDataEvent", false, 0, prev));
				await this.control.send(new lib.SubscriptionRequest("minimap:PlayerPositionEvent", false, 0, prev));
			} catch (err) {
				this.logger.error(`Failed to remove previous minimap filters: ${err}`);
			}
		}

		this.currentFilters = newFilters;

		// Apply new filters if we have active callbacks
		if (this.hasActiveCallbacks()) {
			await this.updateSubscriptions();
		}
	}

	// Update instance/surface filter used for subscriptions.
	async setInstanceSurfaceFilter(instanceId: number | null, surface: string | null) {
		await this.setInstanceSurfaceFilters(
			instanceId !== null && surface
				? [{ instanceId, surface }]
				: null,
		);
	}

	private async updateSubscriptions() {
		if (!this.control.connector.connected) {
			return;
		}

		const shouldSubscribe = this.hasActiveCallbacks();

		// Only subscribe if we both have active callbacks and a specific filter set
		if (shouldSubscribe && this.currentFilters && this.currentFilters.length > 0) {
			// Always (re)send with current filters when we have active callbacks
			const filters = this.currentFilters;
			try {
				await this.control.send(new lib.SubscriptionRequest("minimap:TileDataEvent", true, 0, filters));
				await this.control.send(new lib.SubscriptionRequest("minimap:ChartTagDataEvent", true, 0, filters));
				await this.control.send(new lib.SubscriptionRequest("minimap:RecipeDataEvent", true, 0, filters));
				await this.control.send(new lib.SubscriptionRequest("minimap:PlayerPositionEvent", true, 0, filters));
				this.subscribed = true;
			} catch (err) {
				this.logger.error(`Failed to subscribe to minimap events: ${err}`);
			}
		} else if ((!shouldSubscribe || !this.currentFilters || this.currentFilters.length === 0) && this.subscribed) {
			// Unsubscribe from all minimap events
			try {
				await this.control.send(new lib.SubscriptionRequest("minimap:TileDataEvent", false));
				await this.control.send(new lib.SubscriptionRequest("minimap:ChartTagDataEvent", false));
				await this.control.send(new lib.SubscriptionRequest("minimap:RecipeDataEvent", false));
				await this.control.send(new lib.SubscriptionRequest("minimap:PlayerPositionEvent", false));
				this.subscribed = false;
			} catch (err) {
				this.logger.error(`Failed to unsubscribe from minimap events: ${err}`);
			}
		}
	}

	private hasActiveCallbacks(): boolean {
		return this.tileUpdateCallbacks.length > 0
			|| this.chartTagUpdateCallbacks.length > 0
			|| this.recipeUpdateCallbacks.length > 0
			|| this.playerPositionUpdateCallbacks.length > 0;
	}

	async handleTileDataEvent(event: TileDataEvent) {
		// Notify all registered callbacks
		for (let callback of this.tileUpdateCallbacks) {
			callback(event);
		}
	}

	async handleChartTagDataEvent(event: ChartTagDataEvent) {
		for (let callback of this.chartTagUpdateCallbacks) {
			callback(event);
		}
	}

	async handleRecipeDataEvent(event: RecipeDataEvent) {
		for (let callback of this.recipeUpdateCallbacks) {
			callback(event);
		}
	}

	async handlePlayerPositionEvent(event: PlayerPositionEvent) {
		for (let callback of this.playerPositionUpdateCallbacks) {
			callback(event);
		}
	}

	onTileUpdate(callback: (event: TileDataEvent) => void) {
		this.tileUpdateCallbacks.push(callback);
		this.updateSubscriptions();
	}

	offTileUpdate(callback: (event: TileDataEvent) => void) {
		let index = this.tileUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.tileUpdateCallbacks.splice(index, 1);
		this.updateSubscriptions();
	}

	onChartTagUpdate(callback: (event: ChartTagDataEvent) => void) {
		this.chartTagUpdateCallbacks.push(callback);
		this.updateSubscriptions();
	}

	offChartTagUpdate(callback: (event: ChartTagDataEvent) => void) {
		let index = this.chartTagUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.chartTagUpdateCallbacks.splice(index, 1);
		this.updateSubscriptions();
	}

	onRecipeUpdate(callback: (event: RecipeDataEvent) => void) {
		this.recipeUpdateCallbacks.push(callback);
		this.updateSubscriptions();
	}

	offRecipeUpdate(callback: (event: RecipeDataEvent) => void) {
		const index = this.recipeUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.recipeUpdateCallbacks.splice(index, 1);
		this.updateSubscriptions();
	}

	onPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void) {
		this.playerPositionUpdateCallbacks.push(callback);
		this.updateSubscriptions();
	}

	offPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void) {
		const index = this.playerPositionUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.playerPositionUpdateCallbacks.splice(index, 1);
		this.updateSubscriptions();
	}
}
