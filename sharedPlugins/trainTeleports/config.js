/*
	Clusterio plugin for teleporting trains between servers
*/
module.exports = {
	// Name of package. For display somewhere I guess.
	name: "trainTeleports",
	version: "1.0.0",
	binary: "nodePackage",
	description: "Clusterio plugin for teleporting trains between servers",
	scriptOutputFileSubscription: "trainTeleports.txt",
	masterPlugin: "masterPlugin.js",
}
