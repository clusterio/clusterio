const fileOps = require("_app/fileOps");

module.exports = {
	sync: function(){
		let instances;
		try {
			instances = fileOps.getDirectoriesSync("./instances/");
		} catch (e) {
			// there are no instances created yet, probably missing the folder
			instances = [];
		}
		return instances;
	}
}