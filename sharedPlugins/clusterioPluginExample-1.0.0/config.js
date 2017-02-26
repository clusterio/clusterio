/*
	Example config file for example Clusterio plugin
	Binary will be spawned using child_process.fork and get input from stdin and text from stdout will be ran as
	commands in the factorio server.
*/

module.exports = {
	name: "clusterioPluginExample.exe",
	version: "1.0.0",
	binary: "clusterioPluginExample",
	description: "Example plugin for Clusterio to show easy interface integration with factorio servers.",
}