/*
	Config for clusterio remote mapping plugin. Will handle writing out new map data, aggregating it and sending it to the master (or something) for
	display/interaction.
*/
var modInfo = require("./info.json");
module.exports = {
	// Name of package. For display somewhere I guess.
	name: modInfo.name,
	version: modInfo.version,
	// Binary entrypoint for plugin. Don't let it crash. Stdout is sent to game as server chat (run /c commands from here for interface)
	// Make sure its cross platform somehow.
	binary: "nodePackage",
	description: modInfo.description,
	// We'll send everything in this file to your stdin. Beware.
	scriptOutputFileSubscription: "remoteMap.txt",
}