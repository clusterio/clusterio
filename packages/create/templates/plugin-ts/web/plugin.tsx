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
//%if multi_context // Subscribing requires multi context

import {
	PluginExampleEvent, PluginExampleRequest,
//%endif
//%if controller & web // Subscribing requires web content and the controller
	ExampleSubscribableUpdate, ExampleSubscribableValue,
//%endif
//%if multi_context // Subscribing requires multi context
} from "../messages";
//%endif

import * as lib from "@clusterio/lib";

function MyTemplatePage() {
	const control = useContext(ControlContext);
//%if controller // Subscribing requires web content and the controller
	const plugin = control.plugins.get("__plugin_name__") as WebPlugin;
	const [subscribableData, synced] = plugin.useSubscribableData();
//%endif

	return <PageLayout nav={[{ name: "__plugin_name__" }]}>
		<h2>__plugin_name__</h2>
//%if controller // Subscribing requires web content and the controller
		Synced: {String(synced)} Data: {JSON.stringify([...subscribableData.values()])}
//%endif
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
//%if controller // Subscribing requires web content and the controller
	subscribableData = new lib.EventSubscriber(ExampleSubscribableUpdate, this.control);

//%endif
	async init() {
		this.pages = [
			{
				path: "/__plugin_name__",
				sidebarName: "__plugin_name__",
				// This permission is client side only, so it must match the permission string of a resource request to be secure
				// An undefined value means that the page will always be visible
//%if controller // Subscribing requires web content and the controller
				permission: "__plugin_name__.example.permission.subscribe",
//%endif
//%if !controller
				permission: undefined, // "__plugin_name__.example.permission.request",
//%endif
				content: <MyTemplatePage/>,
			},
		];
//%if multi_context

		this.control.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.control.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%endif
	}
//%if controller // Subscribing requires web content and the controller

	useSubscribableData() {
		const control = useContext(ControlContext);
		const subscribe = useCallback((callback: () => void) => this.subscribableData.subscribe(callback), [control]);
		return useSyncExternalStore(subscribe, () => this.subscribableData.getSnapshot());
	}
//%endif
//%if multi_context

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
//%endif
}
