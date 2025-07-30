import React from "react";
import { BaseWebPlugin } from "@clusterio/web_ui";
import CanvasMinimapPage from "./CanvasMinimapPage";
import { TileDataEvent, ChartTagDataEvent, RecipeDataEvent, PlayerPositionEvent } from "../messages";

export class WebPlugin extends BaseWebPlugin {
	tileUpdateCallbacks: Array<(event: TileDataEvent) => void> = [];
	chartTagUpdateCallbacks: Array<(event: ChartTagDataEvent) => void> = [];
	recipeUpdateCallbacks: Array<(event: RecipeDataEvent) => void> = [];
	playerPositionUpdateCallbacks: Array<(event: PlayerPositionEvent) => void> = [];

	async init() {
		this.pages = [
			{
				path: "/minimap",
				sidebarName: "Minimap",
				permission: "minimap.view",
				content: <CanvasMinimapPage />,
			},
		];

		// Handle tile update events from the controller
		this.control.handle(TileDataEvent, this.handleTileDataEvent.bind(this));
		this.control.handle(ChartTagDataEvent, this.handleChartTagDataEvent.bind(this));
		this.control.handle(RecipeDataEvent, this.handleRecipeDataEvent.bind(this));
		this.control.handle(PlayerPositionEvent, this.handlePlayerPositionEvent.bind(this));
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
	}

	offTileUpdate(callback: (event: TileDataEvent) => void) {
		let index = this.tileUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.tileUpdateCallbacks.splice(index, 1);
	}

	onChartTagUpdate(callback: (event: ChartTagDataEvent) => void) {
		this.chartTagUpdateCallbacks.push(callback);
	}

	offChartTagUpdate(callback: (event: ChartTagDataEvent) => void) {
		let index = this.chartTagUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.chartTagUpdateCallbacks.splice(index, 1);
	}

	onRecipeUpdate(callback: (event: RecipeDataEvent) => void) {
		this.recipeUpdateCallbacks.push(callback);
	}

	offRecipeUpdate(callback: (event: RecipeDataEvent) => void) {
		const index = this.recipeUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.recipeUpdateCallbacks.splice(index, 1);
	}

	onPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void) {
		this.playerPositionUpdateCallbacks.push(callback);
	}

	offPlayerPositionUpdate(callback: (event: PlayerPositionEvent) => void) {
		const index = this.playerPositionUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.playerPositionUpdateCallbacks.splice(index, 1);
	}
}
