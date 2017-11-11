/**
Provides tools for managing both masters and slaves config files.
@module configManager
*/
// require modules
const asTable = require("as-table").configure({delimiter: ' | '});

// internal requires
const config = require("./../../config");
/**
console.log()s each entry in the config

@param {string} instance Either undefined, "shared" or the instance to show the config for.
*/
module.exports.displayConfig = function(instance){
	if(!instance || instance == "shared"){
		let configArray = [];
		Object.keys(config).forEach(key=>{
			if(key != "__comment"){
				if(typeof config[key] == "object"){
					configArray.push({entry: key, value: JSON.stringify(config[key])});
				} else configArray.push({entry: key, value: config[key]});
			}
		});
		console.log(asTable(configArray));
	}
}
