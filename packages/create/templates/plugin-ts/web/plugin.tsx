import React, { useContext, useEffect, useState } from "react";
// import { } from "antd";

import {
	BaseWebPlugin, PageLayout, Control, ControlContext, notifyErrorHandler,
} from "@clusterio/web_ui";

import * as lib from "@clusterio/lib";
import { PluginExampleEvent, PluginExampleRequest } from "../messages";

function MyTemplatePage() {
	let control = useContext(ControlContext);

	return <PageLayout nav={[{ name: "// plugin_name //" }]}>
		<h2>// plugin_name //</h2>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/// plugin_name //",
				sidebarName: "// plugin_name //",
				permission: "// plugin_name //.page.view",
				content: <MyTemplatePage/>,
			},
		];

		this.control.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.control.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
	}

	async handlePluginExampleEvent(event: PluginExampleEvent) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request: PluginExampleRequest) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
}
