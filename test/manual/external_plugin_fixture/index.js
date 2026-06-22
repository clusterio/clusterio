"use strict";
const lib = require("@clusterio/lib");

lib.definePermission({
	name: "mock_external_web.page.view",
	title: "Mock external web page view",
	description: "Reproduction fixture page view permission",
	grantByDefault: true,
});

const plugin = {
	name: "mock_external_web",
	title: "Mock External Web",
	description: "Reproduction fixture for the external-plugin --dev-plugin build",
	webEntrypoint: "./web",
	routes: [
		"/mock_external_web",
	],
};

module.exports = {
	plugin,
};
