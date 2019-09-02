/*
	Example config file for example Clusterio plugin
*/

module.exports = {
	// Name of package. For display somewhere I guess.
	name: "UPSdisplay",
	version: "2.0.0",
	description: "Internal clusterio plugin to get the worlds UPS and display it on master",
	// We'll send everything in this file to your stdin. Beware.
	scriptOutputFileSubscription: "UPSdisplay.txt",
}