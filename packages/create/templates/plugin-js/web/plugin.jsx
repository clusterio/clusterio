const { useContext, useEffect, useState } = require("react");
// const { } = require("antd");

const {
	BaseWebPlugin, PageLayout, Control, ControlContext, notifyErrorHandler,
} = require("@clusterio/web_ui");

const lib = require("@clusterio/lib");
const { PluginExampleEvent, PluginExampleRequest } = require("../messages");

function MyTemplatePage() {
	let control = useContext(ControlContext);

	return <PageLayout nav={[{ name: "// plugin_name //" }]}>
		<h2>// plugin_name //</h2>
	</PageLayout>;
}

class WebPlugin extends BaseWebPlugin {
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
