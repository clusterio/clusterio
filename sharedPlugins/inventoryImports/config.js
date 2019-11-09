/*

This clusterio plugin is tasked to read your inventory and logistic request slots
it will then attempt to fulfill those requests using items provided by the master
server.  There *should* be an in game GUI to toggle this.

*/

module.exports = {
	// Name of package. For display somewhere I guess.
	name: "inventoryImports",
	version: "1.0.0",
	// Binary entrypoint for plugin. Don't let it crash. Stdout is sent to game as server chat (run /c commands from here for interface)
	// Make sure its cross platform somehow.
	binary: "nodePackage",
	arguments: ["index.js"],
	description: "Clusterio plugin to fill character logistic slots with master imports",
	// We'll send everything in this file to your stdin. Beware.
	scriptOutputFileSubscription: "inventoryImports.txt",
	fileReadDelay: 100,
}