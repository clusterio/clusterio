/**

Functions frequently needed from different places in the cluster. Ex:
  * Getting an instance's displayname from their ID

*/

module.exports = ({config} = {}) => ({
	/**
		async function to get an instances displayname from their instanceID
		
		arg1 is the instanceID
		Promise resolves with a string, either the displayName or instanceID if not found.
	*/
	getInstanceName: require("./getInstanceName")(config),
})
