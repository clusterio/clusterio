import React from "react";
import { BaseWebPlugin } from "@clusterio/web_ui";
import CanvasMinimapPage from "./CanvasMinimapPage";
import { TileDataEvent } from "../messages";

export class WebPlugin extends BaseWebPlugin {
	tileUpdateCallbacks: Array<(event: TileDataEvent) => void> = [];

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
	}

	async handleTileDataEvent(event: TileDataEvent) {
		// Notify all registered callbacks
		for (let callback of this.tileUpdateCallbacks) {
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
} 
