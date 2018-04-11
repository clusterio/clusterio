/*
	Config for clusterio remote command plugin.
	Allows you to execute commands on slaves with a web API.
	
	Careful, may allow for RCE vulnerabilities.
*/
var modInfo = require("./info.json");
module.exports = {
	// Name of package. For display somewhere I guess.
	name: "remoteCommands",
	version: "1.0.0",
	binary: "nodePackage",
	description: "Config for clusterio remote command plugin. Allows you to execute commands on slaves with a web API.",
}