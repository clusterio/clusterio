import React, {
	useContext, useEffect, useState,
//%if controller & web // Subscribing requires web content and the controller
	useCallback, useSyncExternalStore,
//%endif
} from "react";

// import {
//
// } from "antd";

import {
	BaseWebPlugin, PageLayout, Control, ControlContext, notifyErrorHandler,
} from "@clusterio/web_ui";

import {
	PluginExampleEvent, PluginExampleRequest,
//%if controller & web // Subscribing requires web content and the controller
	ExampleSubscribableUpdate,
//%endif
} from "../messages";

import * as lib from "@clusterio/lib";

function MyTemplatePage() {
	const control = useContext(ControlContext);
//%if controller & web // Subscribing requires web content and the controller
	const plugin = control.plugins.get("__plugin_name__") as WebPlugin;
	const [subscribableData, synced] = plugin.useSubscribableData();
//%endif

	return <PageLayout nav={[{ name: "__plugin_name__" }]}>
		<h2>__plugin_name__</h2>
//%if controller & web // Subscribing requires web content and the controller
		Synced: {String(synced)} Data: {JSON.stringify([...subscribableData.values()])}
//%endif
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
//%if controller & web // Subscribing requires web content and the controller
	subscribableData = new lib.EventSubscriber(ExampleSubscribableUpdate, this.control);

//%endif
	async init() {
		this.pages = [
			{
				path: "/__plugin_name__",
				sidebarName: "__plugin_name__",
				permission: "__plugin_name__.page.view",
				content: <MyTemplatePage/>,
			},
		];

		this.control.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.control.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
	}
//%if controller & web // Subscribing requires web content and the controller

	useSubscribableData() {
		const control = useContext(ControlContext);
		const subscribe = useCallback((callback: () => void) => this.subscribableData.subscribe(callback), [control]);
		return useSyncExternalStore(subscribe, () => this.subscribableData.getSnapshot());
	}
//%endif

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
