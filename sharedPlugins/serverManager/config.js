/*
	Clusterio plugin for remote server management
*/
module.exports = {
	name: "serverManager",
	version: "1.0.0",
	binary: "nodePackage",
	description: "Server management tools for remote config edits and web based server management",
	masterPlugin: "masterPlugin.js",
	dependencies: [
		"playerManager",
	]
}
