import React from "react";
import { BaseWebPlugin } from "@clusterio/web_ui";
import MinimapPage from "./MinimapPage";

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/minimap",
				sidebarName: "Minimap",
				permission: "minimap.view",
				content: <MinimapPage />,
			},
		];
	}
} 
