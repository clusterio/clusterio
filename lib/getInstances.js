const fileOps = require("lib/fileOps");
// const config = require("./../config");

module.exports = function(config) {
	return {
		sync: function(){
			let instances;
			try {
				instances = fileOps.getDirectoriesSync(config.instanceDirectory);
			} catch (e) {
				// there are no instances created yet, probably missing the folder
				instances = [];
			}
			return instances;
		},
	}
}