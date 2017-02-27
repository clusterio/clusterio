/*
	Example config file for example Clusterio plugin
	Binary will be spawned using child_process.spawn and get input from stdin and text from stdout will be ran as
	commands in the factorio server.
*/

module.exports = {
	// Name of package. For display somewhere I guess.
	name: "clusterioPluginExample",
	version: "1.0.0",
	// Binary entrypoint for plugin. Don't let it crash. Stdout is sent to game as server chat (run /c commands from here for interface)
	// Make sure its cross platform somehow.
	binary: "clusterioPluginExample",
	description: "Example plugin for Clusterio to show easy interface integration with factorio servers.",
	// We'll send everything in this file to your stdin. Beware.
	scriptOutputFileSubscription: "example.txt",
}