const { useContext, useEffect, useState,/*/ [subscribable] /*/ useCallback, useSyncExternalStore,/*/ [] /*/ } = require("react");
// const { } = require("antd");

const {
	BaseWebPlugin, PageLayout, Control, ControlContext, notifyErrorHandler,
} = require("@clusterio/web_ui");

const lib = require("@clusterio/lib");
const { PluginExampleEvent, PluginExampleRequest,/*/ [subscribable] /*/ ExampleSubscribableUpdate,/*/ [] /*/ } = require("../messages");

function MyTemplatePage() {
	let control = useContext(ControlContext);// [subscribable] //
	const plugin = control.plugins.get("// plugin_name //");
	const [subscribableData, synced] = plugin.useSubscribableData();// [] //

	return <PageLayout nav={[{ name: "// plugin_name //" }]}>
		<h2>// plugin_name //</h2>// [subscribable] //
		Synced: {String(synced)} Data: {JSON.stringify([...subscribableData.values()])}// [] //
	</PageLayout>;
}

class WebPlugin extends BaseWebPlugin {// [subscribable] //
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
		const subscribe = useCallback((callback) => this.subscribableData.subscribe(callback), [control]);
		return useSyncExternalStore(subscribe, () => this.subscribableData.getSnapshot());
	}// [] //

	async handlePluginExampleEvent(event) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
}

module.exports = {
	WebPlugin,
};
