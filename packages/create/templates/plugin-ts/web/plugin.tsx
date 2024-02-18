import React, { useContext, useEffect, useState/*/ [subscribable] /*/, useCallback, useSyncExternalStore/*/ [] /*/ } from "react";
// import { } from "antd";

import {
	BaseWebPlugin, PageLayout, Control, ControlContext, notifyErrorHandler,
} from "@clusterio/web_ui";

import * as lib from "@clusterio/lib";
import { PluginExampleEvent, PluginExampleRequest/*/ [subscribable] /*/, ExampleSubscribableUpdate/*/ [] /*/ } from "../messages";

function MyTemplatePage() {
	const control = useContext(ControlContext);// [subscribable] //
	const plugin = control.plugins.get("// plugin_name //") as WebPlugin;
	const [subscribableData, synced] = plugin.useSubscribableData();// [] //

	return <PageLayout nav={[{ name: "// plugin_name //" }]}>
		<h2>// plugin_name //</h2>// [subscribable] //
		Synced: {String(synced)} Data: {JSON.stringify([...subscribableData.values()])}// [] //
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {// [subscribable] //
	subscribableData = new lib.EventSubscriber(ExampleSubscribableUpdate, this.control);
	// [] //
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
	}// [subscribable] //

	useSubscribableData() {
		const control = useContext(ControlContext);
		const subscribe = useCallback((callback: () => void) => this.subscribableData.subscribe(callback), [control]);
		return useSyncExternalStore(subscribe, () => this.subscribableData.getSnapshot());
	}// [] //

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
