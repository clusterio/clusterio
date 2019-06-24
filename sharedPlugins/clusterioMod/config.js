/*
	Clusterio plugin to allow for chat between instances.
*/
module.exports = {
	// Name of package. For display somewhere I guess.
	name: "clusterioMod",
	version: "1.0.0",
	binary: "nodePackage",
	description: "Server side handling of functionality in the clusterio lua mod",
	masterPlugin: "masterPlugin.js",
}
