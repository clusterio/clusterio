import React from "react";
import { BaseWebPlugin } from "@clusterio/web_ui";
import CanvasMinimapPage from "./CanvasMinimapPage";
import { ChunkUpdateEvent } from "../messages";

export class WebPlugin extends BaseWebPlugin {
	chunkUpdateCallbacks: Array<(event: ChunkUpdateEvent) => void> = [];

	async init() {
		this.pages = [
			{
				path: "/minimap",
				sidebarName: "Minimap", 
				permission: "minimap.view",
				content: <CanvasMinimapPage />,
			},
		];
		
		// Handle chunk update events from the controller
		this.control.handle(ChunkUpdateEvent, this.handleChunkUpdateEvent.bind(this));
	}

	async handleChunkUpdateEvent(event: ChunkUpdateEvent) {
		// Notify all registered callbacks
		for (let callback of this.chunkUpdateCallbacks) {
			callback(event);
		}
	}

	onChunkUpdate(callback: (event: ChunkUpdateEvent) => void) {
		this.chunkUpdateCallbacks.push(callback);
	}

	offChunkUpdate(callback: (event: ChunkUpdateEvent) => void) {
		let index = this.chunkUpdateCallbacks.lastIndexOf(callback);
		if (index === -1) {
			throw new Error("callback is not registered");
		}
		this.chunkUpdateCallbacks.splice(index, 1);
	}
} 
