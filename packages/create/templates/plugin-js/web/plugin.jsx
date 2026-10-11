import React, {
	useContext, useEffect, useState,
//%if controller // Subscribing requires web content and the controller
	useCallback, useSyncExternalStore,
//%endif
} from "react";

// import {
//
// } from "antd";

import {
	PageLayout, PageHeader, Control, ControlContext, notifyErrorHandler,
} from "@clusterio/web_ui";
//%if multi_context // Messages requires multi context

import {
	PluginExampleEvent, PluginExampleRequest,
//%endif
//%if controller // Subscribing requires web content and the controller
	ExampleSubscribableUpdate, ExampleSubscribableValue,
//%endif
//%if multi_context // Messages requires multi context
} from "../messages.js";
//%endif

import * as lib from "@clusterio/lib";
//%if controller // Subscribing requires web content and the controller

// Created when the plugin is loaded, before any page is rendered
let exampleSubscriber;

function useSubscribableData() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback) => exampleSubscriber.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => exampleSubscriber.getSnapshot());
}
//%endif

function MyTemplatePage() {
	let control = useContext(ControlContext);
//%if controller // Subscribing requires web content and the controller
	const [subscribableData, synced] = useSubscribableData();
//%endif

	return <PageLayout nav={[{ name: "__plugin_name__" }]}>
		<PageHeader title="__plugin_name__" />
//%if controller // Subscribing requires web content and the controller
		Synced: {String(synced)} Data: {JSON.stringify([...subscribableData.values()])}
//%endif
	</PageLayout>;
}

export default async function loadWebPlugin(context) {
	const { control, logger, plugin } = context;
//%if controller // Subscribing requires web content and the controller
	exampleSubscriber = new lib.MapSubscriber(ExampleSubscribableUpdate, control);
//%endif

	control.hooks.pages.attach(plugin.name, () => [
		{
			path: "/__plugin_name__",
			sidebarName: "__plugin_name__",
			// This permission is client side only, so it must match the permission string of a resource request to be secure
			// An undefined value means that the page will always be visible
//%if controller // Subscribing requires web content and the controller
			permission: "__plugin_name__.example.permission.subscribe",
//%endif
//%if !controller
			permission: "__plugin_name__.page.view",
//%endif
			content: <MyTemplatePage/>,
		},
	]);
//%if multi_context

	control.handle(PluginExampleEvent, async (event) => {
		logger.info(JSON.stringify(event));
	});

	control.handle(PluginExampleRequest, async (request) => {
		logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	});
//%endif
}
