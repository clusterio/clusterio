/**

Functions frequently needed from different places in the cluster. Ex:
  * Loading Lua scripts
  * Checking if hotpatch is installed
  * Getting an instance's displayname from their ID

*/

module.exports = ({config} = {}) => ({
	/**
		async function to get Lua from a file, remove comments, minify and return.
		
		arg1 is the file path
		arg2 is whether or not to compress the Lua. Makes debugging harder, but reduces bandwidth when many players are online. Recommended for polling commands. Defaults to true.
		Promise resolves with a string of Lua.
	*/
	getLua: require("./getLua.js"),
	/**
		async function to check whether hotpatch is installed in a server.
		
		First argument is the servers async messageInterface for rcon return values
		Promise resolves with boolean.
	*/
	checkHotpatchInstallation: require("./checkHotpatchInstallation.js"),
	/**
		async function to get an instances displayname from their instanceID
		
		arg1 is the instanceID
		Promise resolves with a string, either the displayName or instanceID if not found.
	*/
	getInstanceName: require("./getInstanceName.js")(config),
	/**
		async function same as getLua, but using an in memory cache to lower FS operations.
		
		arg1 is the file path
		arg2 is whether or not to compress, default true
		Promise resolves with a string of Lua.
	*/
	getCommand: require("./getCommand.js"),
})